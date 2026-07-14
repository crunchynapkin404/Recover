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
  return {
    default: {
      generateVAPIDKeys: real.default.generateVAPIDKeys,
      sendNotification: (...args: unknown[]) => sendNotification(...args),
    },
  };
});

const USER_A = "test-push-user-a";
const USER_B = "test-push-user-b";

describe.skipIf(!hasDb)("push pipeline", () => {
  beforeAll(async () => {
    const { db, schema } = await import("@/lib/db");
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
    const { db, schema } = await import("@/lib/db");
    for (const id of [USER_A, USER_B])
      await db.delete(schema.users).where(eq(schema.users.id, id));
  });

  it("getVapidKeys is idempotent across calls", async () => {
    const { getVapidKeys } = await import("@/lib/push");
    const a = await getVapidKeys();
    const b = await getVapidKeys();
    expect(a.publicKey).toBe(b.publicKey);
    expect(a.privateKey).toBe(b.privateKey);
    expect(a.publicKey.length).toBeGreaterThan(20);
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
});
