import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

// VAPID private keys are encrypted at rest; tests need a key like CI's build step.
process.env.ENCRYPTION_KEY ??=
  "0000000000000000000000000000000000000000000000000000000000000000";

const sendNotification = vi.fn();
vi.mock("web-push", async (importOriginal) => {
  const real = await importOriginal<typeof import("web-push")>();
  // CJS interop: runtime exposes the module under .default, the types don't.
  const mod = (real as unknown as { default?: typeof real }).default ?? real;
  return {
    default: {
      generateVAPIDKeys: mod.generateVAPIDKeys,
      sendNotification: (...args: unknown[]) => sendNotification(...args),
    },
  };
});

const USER_A = "test-push-user-a";
const USER_B = "test-push-user-b";

const VAPID_KEYS = ["vapid_public_key", "vapid_private_key"];

/**
 * The instance VAPID pair is a SINGLE global row-pair in app_config, shared
 * with the live app — there is no per-test scoping possible, and this repo's
 * DB tests run against the real database. The regeneration test below has to
 * corrupt that pair to exercise its branch, and `getVapidKeys()` then writes a
 * BRAND NEW pair. Left alone, every full-suite run silently orphans every real
 * push subscription on the instance: subscriptions are bound to the public key
 * they were minted against, so the next send reports `sent:0, pruned:N` and
 * the athlete has to re-enable notifications by hand, with nothing announcing
 * it.
 *
 * That is exactly what happened on 2026-07-26 and again on 2026-07-27 — twice
 * misdiagnosed as a mystery key rotation. So: snapshot the pair before this
 * file touches anything, and put it back afterwards. `afterAll` rather than an
 * in-test restore, so a mid-test failure still restores.
 */
let vapidSnapshot: { key: string; value: string; updatedAt: Date }[] = [];

// File-level lifecycle: the users must outlive BOTH describe blocks.
beforeAll(async () => {
  if (!hasDb) return;
  const { db, schema } = await import("@/lib/db");
  const { inArray } = await import("drizzle-orm");
  const rows = await db.query.appConfig.findMany({
    where: inArray(schema.appConfig.key, VAPID_KEYS),
  });
  // updatedAt is restored too: it is the first thing anyone checks when push
  // dies ("was the pair rewritten, and when?"), so a test must not move it.
  // Round-tripping through a JS Date truncates Postgres' microseconds to
  // milliseconds — the key material is byte-identical, the timestamp is
  // faithful to the millisecond. Good enough to keep the signal honest.
  vapidSnapshot = rows.map((r) => ({
    key: r.key,
    value: r.value,
    updatedAt: r.updatedAt,
  }));
  for (const id of [USER_A, USER_B]) {
    await db
      .insert(schema.users)
      .values({ id, name: id, email: `${id}@example.invalid` })
      .onConflictDoNothing();
    await db
      .delete(schema.pushSubscriptions)
      .where(eq(schema.pushSubscriptions.userId, id));
  }
});

afterAll(async () => {
  if (!hasDb) return;
  const { db, schema } = await import("@/lib/db");
  const { inArray } = await import("drizzle-orm");
  for (const id of [USER_A, USER_B])
    await db.delete(schema.users).where(eq(schema.users.id, id));

  // Put the instance's real VAPID pair back, exactly as it was.
  await db
    .delete(schema.appConfig)
    .where(inArray(schema.appConfig.key, VAPID_KEYS));
  if (vapidSnapshot.length > 0) {
    await db.insert(schema.appConfig).values(vapidSnapshot);
  }
});

describe.skipIf(!hasDb)("push pipeline", () => {
  it("getVapidKeys is idempotent across calls", async () => {
    const { getVapidKeys } = await import("@/lib/push");
    const a = await getVapidKeys();
    const b = await getVapidKeys();
    expect(a.publicKey).toBe(b.publicKey);
    expect(a.privateKey).toBe(b.privateKey);
    expect(a.publicKey.length).toBeGreaterThan(20);
  });

  it("regenerates keys when the private key can't be decrypted (rotated ENCRYPTION_KEY)", async () => {
    const { db, schema } = await import("@/lib/db");
    const { getVapidKeys } = await import("@/lib/push");
    const before = await getVapidKeys();
    // Simulate a key encrypted under a different ENCRYPTION_KEY.
    await db
      .update(schema.appConfig)
      .set({ value: "deadbeef00:deadbeef00:deadbeef00" })
      .where(eq(schema.appConfig.key, "vapid_private_key"));

    const after = await getVapidKeys();
    expect(after.publicKey).not.toBe(before.publicKey);
    expect(after.privateKey.length).toBeGreaterThan(20);
    // And it settles: a further call returns the regenerated pair.
    const again = await getVapidKeys();
    expect(again.publicKey).toBe(after.publicKey);
  });

  it("sendToUser sends to own subs only and prunes 410s", async () => {
    const { db, schema } = await import("@/lib/db");
    const { sendToUser } = await import("@/lib/push");
    await db.insert(schema.pushSubscriptions).values([
      {
        userId: USER_A,
        endpoint: "https://push.example/a1",
        p256dh: "k",
        auth: "a",
      },
      {
        userId: USER_A,
        endpoint: "https://push.example/a2-dead",
        p256dh: "k",
        auth: "a",
      },
      {
        userId: USER_B,
        endpoint: "https://push.example/b1",
        p256dh: "k",
        auth: "a",
      },
    ]);
    sendNotification.mockImplementation((sub: { endpoint: string }) => {
      if (sub.endpoint.includes("dead")) {
        const err = new Error("gone") as Error & { statusCode: number };
        err.statusCode = 410;
        return Promise.reject(err);
      }
      return Promise.resolve({});
    });

    const res = await sendToUser(USER_A, {
      title: "t",
      body: "b",
      tag: "x",
      url: "/",
    });
    expect(res.sent).toBe(1);
    expect(res.pruned).toBe(1);
    const remaining = await db.query.pushSubscriptions.findMany({
      where: eq(schema.pushSubscriptions.userId, USER_A),
    });
    expect(remaining.map((r) => r.endpoint)).toEqual([
      "https://push.example/a1",
    ]);
    const bCalls = sendNotification.mock.calls.filter((c) =>
      (c[0] as { endpoint: string }).endpoint.includes("/b1")
    );
    expect(bCalls.length).toBe(0);
  });

  it("prunes a subscription on an unrecoverable VAPID key mismatch, but not on a generic 400", async () => {
    const { db, schema } = await import("@/lib/db");
    const { sendToUser } = await import("@/lib/push");
    await db
      .delete(schema.pushSubscriptions)
      .where(eq(schema.pushSubscriptions.userId, USER_A));
    await db.insert(schema.pushSubscriptions).values([
      {
        userId: USER_A,
        endpoint: "https://push.example/apple-mismatch",
        p256dh: "k",
        auth: "a",
      },
      {
        userId: USER_A,
        endpoint: "https://push.example/mozilla-mismatch",
        p256dh: "k",
        auth: "a",
      },
      {
        userId: USER_A,
        endpoint: "https://push.example/generic-400",
        p256dh: "k",
        auth: "a",
      },
    ]);
    sendNotification.mockImplementation((sub: { endpoint: string }) => {
      const err = new Error("bad request") as Error & {
        statusCode: number;
        body: string;
      };
      if (sub.endpoint.includes("apple-mismatch")) {
        err.statusCode = 400;
        err.body = JSON.stringify({ reason: "VapidPkHashMismatch" });
        return Promise.reject(err);
      }
      if (sub.endpoint.includes("mozilla-mismatch")) {
        err.statusCode = 401;
        err.body = JSON.stringify({
          error: "Unauthorized",
          message: "VAPID public key mismatch",
        });
        return Promise.reject(err);
      }
      // A generic 400 unrelated to VAPID must NOT be treated as unfixable.
      err.statusCode = 400;
      err.body = "bad payload";
      return Promise.reject(err);
    });

    const res = await sendToUser(USER_A, {
      title: "t",
      body: "b",
      tag: "x",
      url: "/",
    });
    expect(res.sent).toBe(0);
    expect(res.pruned).toBe(2);
    const remaining = await db.query.pushSubscriptions.findMany({
      where: eq(schema.pushSubscriptions.userId, USER_A),
    });
    expect(remaining.map((r) => r.endpoint)).toEqual([
      "https://push.example/generic-400",
    ]);
  });
});

describe.skipIf(!hasDb)("maybeSendMorningReadinessPush", () => {
  const morning = () => {
    const d = new Date();
    d.setHours(7, 0, 0, 0);
    return d;
  };
  const localYmd = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  async function seedReadyUser(
    userId: string,
    readiness: number | null,
    band: string
  ) {
    const { db, schema } = await import("@/lib/db");
    const today = localYmd(new Date());
    await db
      .delete(schema.notificationPrefs)
      .where(eq(schema.notificationPrefs.userId, userId));
    await db
      .delete(schema.dailyMetrics)
      .where(eq(schema.dailyMetrics.userId, userId));
    await db
      .delete(schema.pushSubscriptions)
      .where(eq(schema.pushSubscriptions.userId, userId));
    await db.insert(schema.dailyMetrics).values({
      userId,
      date: today,
      readiness,
      band: band as "green" | "amber" | "red" | "calibrating",
    });
    await db.insert(schema.pushSubscriptions).values({
      userId,
      endpoint: `https://push.example/${userId}-${Math.random()}`,
      p256dh: "k",
      auth: "a",
    });
  }

  it("sends once, then dedups for the day", async () => {
    sendNotification.mockReset().mockResolvedValue({});
    await seedReadyUser(USER_A, 66, "amber");
    const { maybeSendMorningReadinessPush } = await import("@/lib/push");
    expect(await maybeSendMorningReadinessPush(USER_A, morning())).toBe(true);
    expect(sendNotification).toHaveBeenCalledTimes(1);
    expect(await maybeSendMorningReadinessPush(USER_A, morning())).toBe(false);
    expect(sendNotification).toHaveBeenCalledTimes(1);
  });

  it("skips outside the morning window", async () => {
    sendNotification.mockReset().mockResolvedValue({});
    await seedReadyUser(USER_A, 66, "amber");
    const afternoon = new Date();
    afternoon.setHours(14, 0, 0, 0);
    const { maybeSendMorningReadinessPush } = await import("@/lib/push");
    expect(await maybeSendMorningReadinessPush(USER_A, afternoon)).toBe(false);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("skips while calibrating and when disabled", async () => {
    sendNotification.mockReset().mockResolvedValue({});
    await seedReadyUser(USER_A, null, "calibrating");
    const { maybeSendMorningReadinessPush } = await import("@/lib/push");
    expect(await maybeSendMorningReadinessPush(USER_A, morning())).toBe(false);

    await seedReadyUser(USER_A, 80, "green");
    const { db, schema } = await import("@/lib/db");
    await db.insert(schema.notificationPrefs).values({
      userId: USER_A,
      morningPushEnabled: false,
    });
    expect(await maybeSendMorningReadinessPush(USER_A, morning())).toBe(false);
    expect(sendNotification).not.toHaveBeenCalled();
  });
});
