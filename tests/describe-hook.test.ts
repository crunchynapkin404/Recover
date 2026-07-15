import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

const run = vi.fn().mockResolvedValue({ written: 0, skipped: 0 });
vi.mock("@/lib/strava-describer", () => ({
  runAutoDescribeStrava: (...args: unknown[]) => run(...args),
}));

const ICU_USER = "test-describe-hook-icu";
const STRAVA_USER = "test-describe-hook-strava";

describe.skipIf(!hasDb)("scheduler auto-describe hook", () => {
  beforeAll(async () => {
    const { db, schema } = await import("@/lib/db");
    await db
      .insert(schema.users)
      .values([
        { id: ICU_USER, name: "Hook", email: "dh-icu@example.invalid" },
        { id: STRAVA_USER, name: "Hook", email: "dh-str@example.invalid" },
      ])
      .onConflictDoNothing();
    for (const userId of [ICU_USER, STRAVA_USER]) {
      await db
        .delete(schema.syncJobs)
        .where(eq(schema.syncJobs.userId, userId));
    }
    await db.insert(schema.syncJobs).values([
      {
        userId: ICU_USER,
        provider: "intervals_icu",
        kind: "incremental",
        runAfter: new Date(Date.now() - 1000),
      },
      {
        userId: STRAVA_USER,
        provider: "strava",
        kind: "incremental",
        runAfter: new Date(Date.now() - 1000),
      },
    ]);
  });

  afterAll(async () => {
    const { db, schema } = await import("@/lib/db");
    for (const userId of [ICU_USER, STRAVA_USER]) {
      await db.delete(schema.users).where(eq(schema.users.id, userId));
    }
  });

  it("fires after intervals.icu jobs only", async () => {
    const { runSchedulerTick } = await import("@/lib/sync/scheduler");
    await runSchedulerTick(async () => {});

    const calledFor = run.mock.calls.map((c) => c[0]);
    expect(calledFor).toContain(ICU_USER);
    expect(calledFor).not.toContain(STRAVA_USER);
  });
});
