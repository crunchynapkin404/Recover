import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";
const USER = "test-forecast-assembly-user";

function ymd(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function cleanup() {
  const { db, schema } = await import("@/lib/db");
  await db.delete(schema.weekPlans).where(eq(schema.weekPlans.userId, USER));
  await db
    .delete(schema.trainingPlans)
    .where(eq(schema.trainingPlans.userId, USER));
  await db.delete(schema.races).where(eq(schema.races.userId, USER));
  await db
    .delete(schema.dailyMetrics)
    .where(eq(schema.dailyMetrics.userId, USER));
  await db.delete(schema.users).where(eq(schema.users.id, USER));
}

describe.skipIf(!hasDb)("assembleForecastInputs", () => {
  beforeAll(async () => {
    await cleanup();
    const { db, schema } = await import("@/lib/db");
    await db.insert(schema.users).values({
      id: USER,
      name: "Forecast",
      email: "forecast-assembly@example.invalid",
    });
    await db.insert(schema.dailyMetrics).values({
      userId: USER,
      date: ymd(0),
      ctl: 48,
      atl: 52,
      tsb: -4,
      loadSource: "computed",
    });
  });
  afterAll(cleanup);

  it("returns null without an active plan", async () => {
    const { assembleForecastInputs } = await import("@/lib/race/service");
    expect(await assembleForecastInputs(USER, null)).toBeNull();
  });

  it("assembles start, planned loads, horizon and race anchor", async () => {
    const { generateTrainingPlan } = await import("@/lib/training-plan");
    const { createRace, assembleForecastInputs, nextUpcomingRace } =
      await import("@/lib/race/service");
    await generateTrainingPlan({
      userId: USER,
      raceType: "10k",
      raceDate: ymd(56),
    });
    const created = await createRace(USER, {
      name: "Goal 10k",
      raceType: "10k",
      date: ymd(56),
      priority: "A",
    });
    expect("race" in created).toBe(true);

    const race = await nextUpcomingRace(USER);
    const a = await assembleForecastInputs(USER, race);
    expect(a).not.toBeNull();
    expect(a!.inputs.start).toEqual({ ctl: 48, atl: 52 });
    expect(a!.inputs.targetDate).toBe(ymd(56));
    expect(a!.inputs.plannedLoads.length).toBeGreaterThan(0);
    // every planned load is strictly after today
    expect(a!.inputs.plannedLoads.every((p) => p.date > ymd(0))).toBe(true);
    // no adherence history yet
    expect(a!.inputs.adherenceFraction).toBeNull();
    expect(a!.race?.name).toBe("Goal 10k");
  });

  it("null race anchors on the open week's end", async () => {
    const { assembleForecastInputs } = await import("@/lib/race/service");
    const { getOpenWeekPlan } = await import("@/lib/week-plan/service");
    const week = await getOpenWeekPlan(USER);
    const a = await assembleForecastInputs(USER, null);
    expect(a!.race).toBeNull();
    expect(a!.inputs.targetDate).toBe(week!.days[6].date);
  });
});
