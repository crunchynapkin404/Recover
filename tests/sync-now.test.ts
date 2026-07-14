import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";

const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

const TEST_USER = "test-sync-now-user";

describe.skipIf(!hasDb)("requestImmediateSync", () => {
  beforeAll(async () => {
    const { db, schema } = await import("@/lib/db");
    await db
      .insert(schema.users)
      .values({
        id: TEST_USER,
        name: "SyncNow",
        email: "syncnow@example.invalid",
      })
      .onConflictDoNothing();
    await db
      .delete(schema.syncJobs)
      .where(eq(schema.syncJobs.userId, TEST_USER));
    await db
      .delete(schema.connections)
      .where(eq(schema.connections.userId, TEST_USER));
    await db.insert(schema.connections).values({
      userId: TEST_USER,
      provider: "intervals_icu",
      encryptedAccessToken: "x",
      externalAthleteId: "a1",
      status: "active",
    });
  });

  afterAll(async () => {
    const { db, schema } = await import("@/lib/db");
    await db.delete(schema.users).where(eq(schema.users.id, TEST_USER));
  });

  it("bumps existing pending jobs to now", async () => {
    const { db, schema } = await import("@/lib/db");
    const { requestImmediateSync } = await import("@/lib/sync/scheduler");
    const future = new Date(Date.now() + 6 * 3600_000);
    await db.insert(schema.syncJobs).values({
      userId: TEST_USER,
      provider: "intervals_icu",
      kind: "incremental",
      runAfter: future,
    });
    await requestImmediateSync(TEST_USER);
    const jobs = await db.query.syncJobs.findMany({
      where: and(
        eq(schema.syncJobs.userId, TEST_USER),
        inArray(schema.syncJobs.status, ["pending"])
      ),
    });
    expect(jobs.length).toBe(1);
    expect(jobs[0].runAfter.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("inserts a job when none is pending", async () => {
    const { db, schema } = await import("@/lib/db");
    const { requestImmediateSync } = await import("@/lib/sync/scheduler");
    await db
      .delete(schema.syncJobs)
      .where(eq(schema.syncJobs.userId, TEST_USER));
    await requestImmediateSync(TEST_USER);
    const jobs = await db.query.syncJobs.findMany({
      where: eq(schema.syncJobs.userId, TEST_USER),
    });
    expect(jobs.length).toBe(1);
    expect(jobs[0].provider).toBe("intervals_icu");
  });
});
