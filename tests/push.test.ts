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
 * The logger emits one JSON line per event through console.{log,warn,error}
 * (src/lib/logger.ts). Capture the real thing rather than mocking our own
 * logger — the assertion is then about what actually lands in `docker logs`.
 */
function captureLog(level: "log" | "warn" | "error") {
  const lines: Record<string, unknown>[] = [];
  const spy = vi.spyOn(console, level).mockImplementation((...args) => {
    try {
      lines.push(JSON.parse(String(args[0])));
    } catch {
      // Non-JSON console output from elsewhere; not our concern.
    }
  });
  return {
    restore: () => spy.mockRestore(),
    all: (msg: string) => lines.filter((l) => l.msg === msg),
    find: (msg: string) => lines.find((l) => l.msg === msg),
  };
}

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

  it("logs one line per send carrying the tag and the sent/pruned counts", async () => {
    // Every push in the app funnels through sendToUser, but until v0.30.1
    // only two of its four callers logged anything on success — so a debrief
    // push left no trace at all, and "why did I get two?" was unanswerable
    // from the logs. The record belongs here, once, not in each caller.
    const { db, schema } = await import("@/lib/db");
    const { sendToUser } = await import("@/lib/push");
    await db
      .delete(schema.pushSubscriptions)
      .where(eq(schema.pushSubscriptions.userId, USER_A));
    await db.insert(schema.pushSubscriptions).values([
      {
        userId: USER_A,
        endpoint: "https://push.example/log-live",
        p256dh: "k",
        auth: "a",
      },
      {
        userId: USER_A,
        endpoint: "https://push.example/log-dead",
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

    const lines = captureLog("log");
    await sendToUser(
      USER_A,
      { title: "t", body: "b", tag: "ride-debrief", url: "/" },
      { activityId: "act-123" }
    );
    lines.restore();

    const sentLine = lines.find("push sent");
    expect(sentLine).toBeTruthy();
    expect(sentLine).toMatchObject({
      level: "info",
      userId: USER_A,
      tag: "ride-debrief",
      sent: 1,
      pruned: 1,
      activityId: "act-123",
    });
    // Payload content is personal data (ride names, debrief notes) and must
    // never reach the logs — the tag is enough to tell the sends apart.
    expect(JSON.stringify(sentLine)).not.toContain('"body"');
  });

  it("writes a durable push_sent row, so the record outlives the container", async () => {
    // The log line above is erased by every deploy: Watchtower recreates the
    // container, `docker logs` restarts empty, and the only reason the July
    // double-push question could be answered at all was that the host happened
    // to use journald and someone had sudo. A push that mattered five days ago
    // should be answerable from the database, not from log-retention luck.
    const { db, schema } = await import("@/lib/db");
    const { sendToUser } = await import("@/lib/push");
    const { and, eq: eqOp } = await import("drizzle-orm");

    await db
      .delete(schema.auditLog)
      .where(eqOp(schema.auditLog.userId, USER_A));
    await db
      .delete(schema.pushSubscriptions)
      .where(eq(schema.pushSubscriptions.userId, USER_A));
    await db.insert(schema.pushSubscriptions).values({
      userId: USER_A,
      endpoint: "https://push.example/audit-live",
      p256dh: "k",
      auth: "a",
    });
    sendNotification.mockResolvedValue({});

    await sendToUser(
      USER_A,
      { title: "t", body: "b", tag: "ride-debrief", url: "/" },
      { activityId: "act-audit-1" }
    );

    const rows = await db.query.auditLog.findMany({
      where: and(
        eqOp(schema.auditLog.userId, USER_A),
        eqOp(schema.auditLog.event, "push_sent")
      ),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].metadata).toMatchObject({
      tag: "ride-debrief",
      subscriptions: 1,
      sent: 1,
      pruned: 0,
      activityId: "act-audit-1",
    });
    // Same rule as the log line: the payload is personal data and must not be
    // persisted here either.
    expect(JSON.stringify(rows[0].metadata)).not.toContain('"body"');
  });

  it("keeps push_sent out of the owner-facing security view", async () => {
    // audit_log is a security artifact — it feeds /admin's "Recent security
    // events" list, which takes the most recent 50 rows. At two or three
    // pushes per user per day, an unfiltered list would show nothing but
    // pushes within a day and bury the logins and token grants it exists for.
    const { SECURITY_EVENTS } = await import("@/lib/audit");
    expect(SECURITY_EVENTS).not.toContain("push_sent");
    expect(SECURITY_EVENTS).toContain("login_fail");
  });

  it("logs a warning naming the reason whenever it prunes a subscription", async () => {
    // A silently deleted subscription is how push died unnoticed twice in
    // v0.25 — the athlete keeps riding, nothing arrives, nothing says why.
    const { db, schema } = await import("@/lib/db");
    const { sendToUser } = await import("@/lib/push");
    await db
      .delete(schema.pushSubscriptions)
      .where(eq(schema.pushSubscriptions.userId, USER_A));
    await db.insert(schema.pushSubscriptions).values([
      {
        userId: USER_A,
        endpoint: "https://push.example/prune-410",
        p256dh: "k",
        auth: "a",
      },
      {
        userId: USER_A,
        endpoint: "https://push.example/prune-vapid",
        p256dh: "k",
        auth: "a",
      },
    ]);
    sendNotification.mockImplementation((sub: { endpoint: string }) => {
      const err = new Error("nope") as Error & {
        statusCode: number;
        body?: string;
      };
      if (sub.endpoint.includes("410")) {
        err.statusCode = 410;
        return Promise.reject(err);
      }
      err.statusCode = 400;
      err.body = JSON.stringify({ reason: "VapidPkHashMismatch" });
      return Promise.reject(err);
    });

    const lines = captureLog("warn");
    await sendToUser(USER_A, { title: "t", body: "b", tag: "x", url: "/" });
    lines.restore();

    const pruneLines = lines.all("push subscription pruned");
    expect(pruneLines.length).toBe(2);
    expect(pruneLines.map((l) => l.reason).sort()).toEqual([
      "gone",
      "vapid-mismatch",
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
