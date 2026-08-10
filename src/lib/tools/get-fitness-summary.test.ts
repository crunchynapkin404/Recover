import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getFitnessSummary } from "./get-fitness-summary";

// requires Postgres; skips without DATABASE_URL.
const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

const USER = "test-get-fitness-summary-user";

describe.skipIf(!hasDb)("get_fitness_summary", () => {
  beforeAll(async () => {
    await db
      .insert(schema.users)
      .values({
        id: USER,
        name: "Get Fitness Summary Test",
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
    // daily_metrics — the same table the dashboard reads.
    await db.insert(schema.dailyMetrics).values({
      userId: USER,
      date: "2026-08-05",
      ctl: 42.3,
      atl: 38.1,
      tsb: 4.2,
      loadSource: "computed",
    });

    const result = (await getFitnessSummary.execute(
      {},
      { userId: USER, db }
    )) as { ctl: number | null; atl: number | null; tsb: number | null };

    expect(result.ctl).toBe(42.3);
    expect(result.atl).toBe(38.1);
    expect(result.tsb).toBe(4.2);
  });

  it("still reports eftp from wellness_daily, which has no native equivalent", async () => {
    await db.insert(schema.dailyMetrics).values({
      userId: USER,
      date: "2026-08-05",
      ctl: 40,
      atl: 35,
      tsb: 5,
      loadSource: "computed",
    });
    await db.insert(schema.wellnessDaily).values({
      userId: USER,
      date: "2026-08-05",
      eftp: 275,
    });

    const result = (await getFitnessSummary.execute(
      {},
      { userId: USER, db }
    )) as { eftp: number | null };

    expect(result.eftp).toBe(275);
  });

  it("returns null ctl/atl/tsb/eftp with no data at all, not zeros", async () => {
    const result = (await getFitnessSummary.execute(
      {},
      { userId: USER, db }
    )) as {
      ctl: number | null;
      atl: number | null;
      tsb: number | null;
      eftp: number | null;
    };

    expect(result.ctl).toBeNull();
    expect(result.atl).toBeNull();
    expect(result.tsb).toBeNull();
    expect(result.eftp).toBeNull();
  });
});
