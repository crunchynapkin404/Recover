import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";

// Lock-safety integration test (docs/PLAN.md P2): two concurrent tickers must
// process each job exactly once. Requires Postgres (pg driver); skips otherwise.
const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

const TEST_USER = "test-scheduler-user";

describe.skipIf(!hasDb)("scheduler lock safety", () => {
  beforeAll(async () => {
    const { db, schema } = await import("@/lib/db");
    await db
      .insert(schema.users)
      .values({
        id: TEST_USER,
        name: "Scheduler Test",
        email: "scheduler-test@example.invalid",
      })
      .onConflictDoNothing();
    await db
      .delete(schema.syncJobs)
      .where(eq(schema.syncJobs.userId, TEST_USER));
    await db.insert(schema.syncJobs).values(
      Array.from({ length: 5 }, () => ({
        userId: TEST_USER,
        provider: "intervals_icu" as const,
        kind: "incremental" as const,
        runAfter: new Date(Date.now() - 1000),
      }))
    );
  });

  afterAll(async () => {
    const { db, schema } = await import("@/lib/db");
    await db
      .delete(schema.syncJobs)
      .where(eq(schema.syncJobs.userId, TEST_USER));
    await db.delete(schema.users).where(eq(schema.users.id, TEST_USER));
  });

  it("two concurrent ticks process each job exactly once", async () => {
    const { runSchedulerTick } = await import("@/lib/sync/scheduler");
    const { db, schema } = await import("@/lib/db");

    const processed: string[] = [];
    const stub = async (job: { id: string }) => {
      processed.push(job.id);
      await new Promise((r) => setTimeout(r, 20));
    };

    const [a, b] = await Promise.all([
      runSchedulerTick(stub),
      runSchedulerTick(stub),
    ]);

    expect(a.claimed + b.claimed).toBe(5);
    expect(new Set(processed).size).toBe(5);
    expect(a.failed + b.failed).toBe(0);

    const done = await db.query.syncJobs.findMany({
      where: and(
        eq(schema.syncJobs.userId, TEST_USER),
        eq(schema.syncJobs.status, "done")
      ),
    });
    expect(done).toHaveLength(5);

    // Each completed job chains exactly one next daily run.
    const pending = await db.query.syncJobs.findMany({
      where: and(
        eq(schema.syncJobs.userId, TEST_USER),
        eq(schema.syncJobs.status, "pending")
      ),
    });
    expect(pending).toHaveLength(5);
  });
});
