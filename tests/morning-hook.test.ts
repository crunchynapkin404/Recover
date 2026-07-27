import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

const maybeSend = vi.fn().mockResolvedValue(true);
vi.mock("@/lib/push", () => ({
  maybeSendMorningReadinessPush: (...args: unknown[]) => maybeSend(...args),
}));

const TEST_USER = "test-morning-hook-user";

describe.skipIf(!hasDb)("scheduler morning-push hook", () => {
  beforeAll(async () => {
    const { db, schema } = await import("@/lib/db");
    await db
      .insert(schema.users)
      .values({ id: TEST_USER, name: "Hook", email: "hook@example.invalid" })
      .onConflictDoNothing();
    await db
      .delete(schema.syncJobs)
      .where(eq(schema.syncJobs.userId, TEST_USER));
    await db.insert(schema.syncJobs).values({
      userId: TEST_USER,
      provider: "intervals_icu",
      kind: "incremental",
      runAfter: new Date(Date.now() - 1000),
    });
    // v0.25.17: the brief/push half of the post-sync hook is now gated on
    // last night's overnight measurement having actually arrived, so the
    // fixture needs a complete wellness row — a successful sync job alone
    // no longer implies a push. See brief-completeness.ts.
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    await db
      .insert(schema.wellnessDaily)
      .values({ userId: TEST_USER, date: today, hrvMs: 62, sleepSecs: 25000 })
      .onConflictDoNothing();
  });

  afterAll(async () => {
    const { db, schema } = await import("@/lib/db");
    await db.delete(schema.users).where(eq(schema.users.id, TEST_USER));
  });

  it("calls the morning push after a successful job", async () => {
    const { runSchedulerTick } = await import("@/lib/sync/scheduler");
    await runSchedulerTick(async () => {});
    expect(maybeSend).toHaveBeenCalledWith(TEST_USER, undefined);
  });
});
