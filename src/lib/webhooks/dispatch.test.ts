import { createHmac } from "node:crypto";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { dispatchWebhook, broadcastWebhook } from "./dispatch";

// requires Postgres; skips without DATABASE_URL.
const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

const USER_A = "test-webhook-user";
const USER_B = "test-webhook-user-b";
const SECRET_A = "test-secret";
const SECRET_B = "test-secret-b";

interface FakeCall {
  url: string;
  sig: string | null;
  event: string | null;
  body: string;
}

describe.skipIf(!hasDb)("dispatchWebhook", () => {
  beforeAll(async () => {
    await db
      .insert(schema.users)
      .values([
        {
          id: USER_A,
          name: "Webhook Test A",
          email: `${USER_A}@example.invalid`,
        },
        {
          id: USER_B,
          name: "Webhook Test B",
          email: `${USER_B}@example.invalid`,
        },
      ])
      .onConflictDoNothing();
  });

  afterAll(async () => {
    // webhook_deliveries cascade from webhook_subscriptions; delete subs
    // first (id-scoped via userId IN, never unscoped), then the test users.
    const subs = await db.query.webhookSubscriptions.findMany({
      where: inArray(schema.webhookSubscriptions.userId, [USER_A, USER_B]),
      columns: { id: true },
    });
    if (subs.length > 0) {
      await db.delete(schema.webhookDeliveries).where(
        inArray(
          schema.webhookDeliveries.subscriptionId,
          subs.map((s) => s.id)
        )
      );
    }
    await db
      .delete(schema.webhookSubscriptions)
      .where(inArray(schema.webhookSubscriptions.userId, [USER_A, USER_B]));
    await db
      .delete(schema.users)
      .where(inArray(schema.users.id, [USER_A, USER_B]));
  });

  beforeEach(async () => {
    await db
      .delete(schema.webhookSubscriptions)
      .where(inArray(schema.webhookSubscriptions.userId, [USER_A, USER_B]));
  });

  it("signs the body with the per-subscription HMAC secret and retries on failure", async () => {
    await db.insert(schema.webhookSubscriptions).values({
      userId: USER_A,
      url: "https://hooks.example.invalid/a",
      encryptedSecret: encrypt(SECRET_A),
      events: ["readiness_computed"],
      active: true,
    });

    const calls: FakeCall[] = [];
    const fetcher = vi.fn(
      async (
        url: string,
        init: { headers: Record<string, string>; body: string }
      ) => {
        calls.push({
          url,
          sig: init.headers["x-recover-signature"] ?? null,
          event: init.headers["x-recover-event"] ?? null,
          body: init.body,
        });
        return { ok: calls.length > 1 }; // fail first, succeed on retry
      }
    );

    await dispatchWebhook(
      USER_A,
      "readiness_computed",
      { band: "green" },
      { fetcher, maxAttempts: 2 }
    );

    expect(calls).toHaveLength(2);
    const expected = createHmac("sha256", SECRET_A)
      .update(calls[0].body)
      .digest("hex");
    expect(calls[0].sig).toBe(expected);
    expect(calls[0].event).toBe("readiness_computed");
    // Same body signed both attempts (retry resends, doesn't recompute).
    expect(calls[1].sig).toBe(expected);

    const deliveries = await db.query.webhookDeliveries.findMany({
      where: eq(
        schema.webhookDeliveries.subscriptionId,
        (await db.query.webhookSubscriptions.findFirst({
          where: eq(schema.webhookSubscriptions.userId, USER_A),
          columns: { id: true },
        }))!.id
      ),
    });
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].status).toBe("success");
    expect(deliveries[0].attempts).toBe(2);
  });

  it("records final failure state after exhausting maxAttempts, without throwing", async () => {
    await db.insert(schema.webhookSubscriptions).values({
      userId: USER_A,
      url: "https://hooks.example.invalid/always-down",
      encryptedSecret: encrypt(SECRET_A),
      events: ["readiness_computed"],
      active: true,
    });

    const fetcher = vi.fn(async () => ({ ok: false, status: 500 }));

    await expect(
      dispatchWebhook(
        USER_A,
        "readiness_computed",
        { band: "red" },
        { fetcher, maxAttempts: 3 }
      )
    ).resolves.toBeUndefined();

    expect(fetcher).toHaveBeenCalledTimes(3);

    const sub = await db.query.webhookSubscriptions.findFirst({
      where: eq(schema.webhookSubscriptions.userId, USER_A),
      columns: { id: true },
    });
    const deliveries = await db.query.webhookDeliveries.findMany({
      where: eq(schema.webhookDeliveries.subscriptionId, sub!.id),
    });
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].status).toBe("failed");
    expect(deliveries[0].attempts).toBe(3);
    expect(deliveries[0].lastError).toBeTruthy();
  });

  it("treats a hung fetch as a failed attempt (retries, doesn't hang or throw)", async () => {
    await db.insert(schema.webhookSubscriptions).values({
      userId: USER_A,
      url: "https://hooks.example.invalid/hangs",
      encryptedSecret: encrypt(SECRET_A),
      events: ["readiness_computed"],
      active: true,
    });

    // Simulates a target that accepts the connection but never responds:
    // never resolves on its own, only rejects when the signal dispatch.ts
    // attaches (AbortSignal.timeout) fires — exactly how real fetch/undici
    // behaves under an abort. A short fetchTimeoutMs override keeps this
    // test fast without touching the production FETCH_TIMEOUT_MS constant.
    const fetcher = vi.fn(
      (_url: string, init: { signal?: AbortSignal }) =>
        new Promise<{ ok: boolean; status?: number }>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            reject(
              new DOMException("The operation was aborted.", "TimeoutError")
            );
          });
        })
    );

    await expect(
      dispatchWebhook(
        USER_A,
        "readiness_computed",
        { band: "green" },
        { fetcher, maxAttempts: 2, fetchTimeoutMs: 25 }
      )
    ).resolves.toBeUndefined();

    expect(fetcher).toHaveBeenCalledTimes(2);

    const sub = await db.query.webhookSubscriptions.findFirst({
      where: eq(schema.webhookSubscriptions.userId, USER_A),
      columns: { id: true },
    });
    const deliveries = await db.query.webhookDeliveries.findMany({
      where: eq(schema.webhookDeliveries.subscriptionId, sub!.id),
    });
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].status).toBe("failed");
    expect(deliveries[0].attempts).toBe(2);
    expect(deliveries[0].lastError).toBeTruthy();
  });

  it("never dispatches to another user's subscriptions", async () => {
    await db.insert(schema.webhookSubscriptions).values([
      {
        userId: USER_A,
        url: "https://hooks.example.invalid/a",
        encryptedSecret: encrypt(SECRET_A),
        events: ["readiness_computed"],
        active: true,
      },
      {
        userId: USER_B,
        url: "https://hooks.example.invalid/b",
        encryptedSecret: encrypt(SECRET_B),
        events: ["readiness_computed"],
        active: true,
      },
    ]);

    const calls: string[] = [];
    const fetcher = vi.fn(async (url: string) => {
      calls.push(url);
      return { ok: true };
    });

    await dispatchWebhook(
      USER_A,
      "readiness_computed",
      { band: "green" },
      { fetcher }
    );

    expect(calls).toEqual(["https://hooks.example.invalid/a"]);
  });

  it("skips inactive subscriptions and subscriptions not opted into the event", async () => {
    await db.insert(schema.webhookSubscriptions).values([
      {
        userId: USER_A,
        url: "https://hooks.example.invalid/inactive",
        encryptedSecret: encrypt(SECRET_A),
        events: ["readiness_computed"],
        active: false,
      },
      {
        userId: USER_A,
        url: "https://hooks.example.invalid/wrong-event",
        encryptedSecret: encrypt(SECRET_A),
        events: ["backup_completed"],
        active: true,
      },
    ]);

    const fetcher = vi.fn(async () => ({ ok: true }));
    await dispatchWebhook(
      USER_A,
      "readiness_computed",
      { band: "green" },
      { fetcher }
    );

    expect(fetcher).not.toHaveBeenCalled();
  });

  it("broadcastWebhook dispatches an instance-wide event to every subscribed user, still HMAC-signed per subscription", async () => {
    await db.insert(schema.webhookSubscriptions).values([
      {
        userId: USER_A,
        url: "https://hooks.example.invalid/backup-a",
        encryptedSecret: encrypt(SECRET_A),
        events: ["backup_completed"],
        active: true,
      },
      {
        userId: USER_B,
        url: "https://hooks.example.invalid/backup-b",
        encryptedSecret: encrypt(SECRET_B),
        events: ["backup_completed"],
        active: true,
      },
    ]);

    const calls: FakeCall[] = [];
    const fetcher = vi.fn(
      async (
        url: string,
        init: { headers: Record<string, string>; body: string }
      ) => {
        calls.push({
          url,
          sig: init.headers["x-recover-signature"] ?? null,
          event: init.headers["x-recover-event"] ?? null,
          body: init.body,
        });
        return { ok: true };
      }
    );

    await broadcastWebhook(
      "backup_completed",
      { at: "2026-07-21T00:00:00Z" },
      { fetcher }
    );

    expect(calls.map((c) => c.url).sort()).toEqual([
      "https://hooks.example.invalid/backup-a",
      "https://hooks.example.invalid/backup-b",
    ]);
    const callA = calls.find((c) => c.url.endsWith("/backup-a"))!;
    const callB = calls.find((c) => c.url.endsWith("/backup-b"))!;
    expect(callA.sig).toBe(
      createHmac("sha256", SECRET_A).update(callA.body).digest("hex")
    );
    expect(callB.sig).toBe(
      createHmac("sha256", SECRET_B).update(callB.body).digest("hex")
    );
  });
});
