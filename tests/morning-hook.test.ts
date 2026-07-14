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
  });

  afterAll(async () => {
    const { db, schema } = await import("@/lib/db");
    await db.delete(schema.users).where(eq(schema.users.id, TEST_USER));
  });

  it("calls the morning push after a successful job", async () => {
    const { runSchedulerTick } = await import("@/lib/sync/scheduler");
    await runSchedulerTick(async () => {});
    expect(maybeSend).toHaveBeenCalledWith(TEST_USER);
  });
});
