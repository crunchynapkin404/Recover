import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getWellness } from "./get-wellness";

// requires Postgres; skips without DATABASE_URL.
const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

const USER = "test-get-wellness-user";

describe.skipIf(!hasDb)("get_wellness", () => {
  beforeAll(async () => {
    await db
      .insert(schema.users)
      .values({
        id: USER,
        name: "Get Wellness Test",
        email: `${USER}@example.test`,
      })
      .onConflictDoNothing();
  });

  afterEach(async () => {
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

  it("reports ctl/atl from daily_metrics, matched per day, not wellness_daily's own columns", async () => {
    // A wearable-connected but intervals.icu-disconnected athlete: real
    // HRV/RHR from wellness_daily, but ctl/atl only ever resolved natively
    // into daily_metrics — wellness_daily.ctl/atl stay null for this day.
    await db.insert(schema.wellnessDaily).values({
      userId: USER,
      date: "2026-08-05",
      hrvMs: 55,
      restingHr: 48,
    });
    await db.insert(schema.dailyMetrics).values({
      userId: USER,
      date: "2026-08-05",
      ctl: 45,
      atl: 40,
      tsb: 5,
      loadSource: "computed",
    });

    const result = (await getWellness.execute(
      { days: 7 },
      { userId: USER, db }
    )) as {
      days: Array<{ date: string; ctl: number | null; atl: number | null }>;
    };

    expect(result.days).toHaveLength(1);
    expect(result.days[0].ctl).toBe(45);
    expect(result.days[0].atl).toBe(40);
  });

  it("returns null ctl/atl for a day with wellness but no resolved daily_metrics row", async () => {
    await db.insert(schema.wellnessDaily).values({
      userId: USER,
      date: "2026-08-05",
      hrvMs: 55,
      restingHr: 48,
    });

    const result = (await getWellness.execute(
      { days: 7 },
      { userId: USER, db }
    )) as { days: Array<{ ctl: number | null; atl: number | null }> };

    expect(result.days).toHaveLength(1);
    expect(result.days[0].ctl).toBeNull();
    expect(result.days[0].atl).toBeNull();
  });
});
