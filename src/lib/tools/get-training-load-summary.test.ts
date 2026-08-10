import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getTrainingLoadSummary } from "./get-training-load-summary";

// requires Postgres; skips without DATABASE_URL.
const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

const USER = "test-get-training-load-summary-user";

describe.skipIf(!hasDb)("get_training_load_summary", () => {
  beforeAll(async () => {
    await db
      .insert(schema.users)
      .values({
        id: USER,
        name: "Get Training Load Summary Test",
        email: `${USER}@example.test`,
      })
      .onConflictDoNothing();
  });

  afterEach(async () => {
    // Runs even when an assertion above throws, so one failing test never
    // leaves a row that breaks the next test's insert.
    await db
      .delete(schema.dailyMetrics)
      .where(eq(schema.dailyMetrics.userId, USER));
    await db
      .delete(schema.wellnessDaily)
      .where(eq(schema.wellnessDaily.userId, USER));
  });

  afterAll(async () => {
    await db.delete(schema.users).where(eq(schema.users.id, USER));
  });

  it("reports real ctl/atl/tsb for a manual-only athlete with no wellness_daily rows at all", async () => {
    // The bug this fixes: reading wellnessDaily directly would return null
    // here, even though the native engine resolved real numbers into
    // daily_metrics — the same table get_fitness_summary and the
    // dashboard read.
    await db.insert(schema.dailyMetrics).values({
      userId: USER,
      date: "2026-08-05",
      ctl: 55.5,
      atl: 60.2,
      tsb: -4.7,
      loadSource: "computed",
    });

    const result = (await getTrainingLoadSummary.execute(
      { weeks: 4 },
      { userId: USER, db }
    )) as {
      current: {
        ctl_fitness: number | null;
        atl_fatigue: number | null;
        tsb_form: number | null;
      };
    };

    expect(result.current.ctl_fitness).toBe(55.5);
    expect(result.current.atl_fatigue).toBe(60.2);
    expect(result.current.tsb_form).toBe(-4.7);
  });

  it("picks the most recent row with a known ctl, skipping an unresolved later row", async () => {
    await db.insert(schema.dailyMetrics).values([
      {
        userId: USER,
        date: "2026-08-04",
        ctl: 50,
        atl: 45,
        tsb: 5,
        loadSource: "computed",
      },
      // A later day whose ctl/atl couldn't be resolved yet (e.g. sync
      // hasn't run) must not shadow the last known-good figure with null.
      { userId: USER, date: "2026-08-05", ctl: null, atl: null, tsb: null },
    ]);

    const result = (await getTrainingLoadSummary.execute(
      { weeks: 4 },
      { userId: USER, db }
    )) as { current: { as_of: string | null; ctl_fitness: number | null } };

    expect(result.current.as_of).toBe("2026-08-04");
    expect(result.current.ctl_fitness).toBe(50);
  });

  it("returns null current figures with no resolved data at all, not zeros", async () => {
    const result = (await getTrainingLoadSummary.execute(
      { weeks: 4 },
      { userId: USER, db }
    )) as {
      current: {
        as_of: string | null;
        ctl_fitness: number | null;
        atl_fatigue: number | null;
        tsb_form: number | null;
      };
    };

    expect(result.current.as_of).toBeNull();
    expect(result.current.ctl_fitness).toBeNull();
    expect(result.current.atl_fatigue).toBeNull();
    expect(result.current.tsb_form).toBeNull();
  });
});
