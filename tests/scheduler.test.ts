import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
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

const SCHEDULE_USER = "test-schedule-intervals-sync-user";

describe.skipIf(!hasDb)("scheduleIntervalsSync", () => {
  beforeAll(async () => {
    const { db, schema } = await import("@/lib/db");
    await db
      .insert(schema.users)
      .values({
        id: SCHEDULE_USER,
        name: "Schedule Intervals Sync Test",
        email: "schedule-intervals-sync-test@example.invalid",
      })
      .onConflictDoNothing();
    await db
      .insert(schema.connections)
      .values({
        userId: SCHEDULE_USER,
        provider: "intervals_icu",
        encryptedAccessToken: "x",
        externalAthleteId: "i1",
        status: "active",
      })
      .onConflictDoNothing();
  });

  afterAll(async () => {
    const { db, schema } = await import("@/lib/db");
    await db
      .delete(schema.syncJobs)
      .where(eq(schema.syncJobs.userId, SCHEDULE_USER));
    await db
      .delete(schema.connections)
      .where(eq(schema.connections.userId, SCHEDULE_USER));
    await db.delete(schema.users).where(eq(schema.users.id, SCHEDULE_USER));
  });

  beforeEach(async () => {
    const { db, schema } = await import("@/lib/db");
    await db
      .delete(schema.syncJobs)
      .where(eq(schema.syncJobs.userId, SCHEDULE_USER));
  });

  it("creates a job when none exists", async () => {
    const { scheduleIntervalsSync } = await import("@/lib/sync/scheduler");
    const { db, schema } = await import("@/lib/db");

    const before = Date.now();
    await scheduleIntervalsSync(SCHEDULE_USER, 90);

    const job = await db.query.syncJobs.findFirst({
      where: and(
        eq(schema.syncJobs.userId, SCHEDULE_USER),
        eq(schema.syncJobs.provider, "intervals_icu")
      ),
    });
    expect(job?.status).toBe("pending");
    expect(job!.runAfter.getTime()).toBeGreaterThan(before + 60_000);
  });

  it("brings an existing job forward, never pushes it back", async () => {
    const { scheduleIntervalsSync } = await import("@/lib/sync/scheduler");
    const { db, schema } = await import("@/lib/db");

    const farFuture = new Date(Date.now() + 6 * 60 * 60 * 1000);
    await db.insert(schema.syncJobs).values({
      userId: SCHEDULE_USER,
      provider: "intervals_icu",
      kind: "incremental",
      runAfter: farFuture,
    });

    await scheduleIntervalsSync(SCHEDULE_USER, 90);
    const bumped = await db.query.syncJobs.findFirst({
      where: eq(schema.syncJobs.userId, SCHEDULE_USER),
    });
    expect(bumped!.runAfter.getTime()).toBeLessThan(farFuture.getTime());

    // A second call with a longer delay must not push an already-sooner job back.
    const soonerRunAfter = bumped!.runAfter;
    await scheduleIntervalsSync(SCHEDULE_USER, 3600);
    const unchanged = await db.query.syncJobs.findFirst({
      where: eq(schema.syncJobs.userId, SCHEDULE_USER),
    });
    expect(unchanged!.runAfter.getTime()).toBe(soonerRunAfter.getTime());
  });

  it("no-ops when the user has no active intervals.icu connection", async () => {
    const { scheduleIntervalsSync } = await import("@/lib/sync/scheduler");
    const { db, schema } = await import("@/lib/db");

    await scheduleIntervalsSync("test-nonexistent-user-xyz", 90);
    const jobs = await db.query.syncJobs.findMany({
      where: eq(schema.syncJobs.userId, "test-nonexistent-user-xyz"),
    });
    expect(jobs).toHaveLength(0);
  });
});
