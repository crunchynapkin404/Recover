import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";

const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";
const USER = "test-forecast-assembly-user";

function ymd(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDays(ymdStr: string, n: number): string {
  const d = new Date(ymdStr + "T00:00:00");
  d.setDate(d.getDate() + n);
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

  it("B/C-priority race anchors targetDate but does not reshape future weeks", async () => {
    const { generateTrainingPlan } = await import("@/lib/training-plan");
    const { createRace, assembleForecastInputs } =
      await import("@/lib/race/service");
    await generateTrainingPlan({
      userId: USER,
      raceType: "10k",
      raceDate: ymd(70),
    });
    const created = await createRace(USER, {
      name: "Tune-up 10k",
      raceType: "10k",
      date: ymd(20),
      priority: "B",
    });
    if (!("race" in created)) throw new Error("race creation failed");
    const race = created.race;

    const withRace = await assembleForecastInputs(USER, race);
    const withNull = await assembleForecastInputs(USER, null);
    expect(withRace).not.toBeNull();
    expect(withNull).not.toBeNull();

    // B priority still anchors the target date on the race...
    expect(withRace!.inputs.targetDate).toBe(race.date);
    expect(withRace!.inputs.targetDate).not.toBe(withNull!.inputs.targetDate);

    // ...but must NOT trigger taper reshaping: planned loads for future
    // skeleton weeks are identical to the no-race case, since raceCtx only
    // gets set for an A-priority race.
    expect(withRace!.inputs.plannedLoads).toEqual(
      withNull!.inputs.plannedLoads
    );
  });

  it("an A-priority race inside a future week's taper window reshapes that week's planned loads", async () => {
    const { db, schema } = await import("@/lib/db");
    const { generateTrainingPlan } = await import("@/lib/training-plan");
    const { createRace, assembleForecastInputs } =
      await import("@/lib/race/service");
    const { getOpenWeekPlan } = await import("@/lib/week-plan/service");

    await generateTrainingPlan({
      userId: USER,
      raceType: "10k",
      raceDate: ymd(42),
    });
    const week = await getOpenWeekPlan(USER);
    expect(week).not.toBeNull();

    // Future week 2 starts 7 days after the open week's start. Put the race
    // 3 days into that week — comfortably inside the d<=6 "race week" taper
    // band, regardless of raceType window class.
    const week2Start = addDays(week!.weekStart, 7);
    const raceDate = addDays(week2Start, 3);

    const created = await createRace(USER, {
      name: "Reshape 10k",
      raceType: "10k",
      date: raceDate,
      priority: "A",
    });
    if (!("race" in created)) throw new Error("race creation failed");
    const race = created.race;

    const block2 = await db.query.trainingBlocks.findFirst({
      where: and(
        eq(schema.trainingBlocks.planId, week!.planId),
        eq(schema.trainingBlocks.weekNumber, 2)
      ),
    });
    expect(block2).toBeDefined();
    const workouts = (block2!.workouts ?? []) as {
      day: number;
      durationMins: number;
    }[];
    const mins = workouts.reduce((s, w) => s + w.durationMins, 0);
    expect(mins).toBeGreaterThan(0);

    const withRace = await assembleForecastInputs(USER, race);
    const withNull = await assembleForecastInputs(USER, null);
    expect(withRace).not.toBeNull();
    expect(withNull).not.toBeNull();

    const week2End = addDays(week2Start, 6);
    const inWeek2 = (p: { date: string }) =>
      p.date >= week2Start && p.date <= week2End;
    const reshaped = withRace!.inputs.plannedLoads.filter(inWeek2);
    const unreshaped = withNull!.inputs.plannedLoads.filter(inWeek2);

    // Hand-computed expectation mirroring assembleForecastInputs' own
    // formula: base = ctlNow * 7 (no closed weeks yet in this fixture, so
    // lastActual is 0), fraction = TAPER_FRACTION_RACE_WEEK (0.45) since
    // the race lands 3 days into the week (d <= 6).
    const ctlNow = 48; // from the beforeAll dailyMetrics fixture
    const expectedTarget = Math.round(ctlNow * 7 * 0.45);
    const expectedReshaped = workouts.map((w) => ({
      date: addDays(week2Start, w.day),
      load: Math.round(expectedTarget * (w.durationMins / mins) * 10) / 10,
    }));
    const expectedUnreshaped = workouts.map((w) => ({
      date: addDays(week2Start, w.day),
      load:
        Math.round(
          (block2!.targetLoadTotal ?? 0) * (w.durationMins / mins) * 10
        ) / 10,
    }));

    expect(reshaped).toEqual(expectedReshaped);
    expect(unreshaped).toEqual(expectedUnreshaped);

    const sum = (xs: { load: number }[]) => xs.reduce((s, x) => s + x.load, 0);
    // Prove the fraction actually changed the numbers, not just that the
    // code path ran.
    expect(sum(reshaped)).not.toBe(sum(unreshaped));
  });

  it("adherenceFraction is the mean of up to 4 most recent prior blocks' adherencePct, ÷100", async () => {
    const { db, schema } = await import("@/lib/db");
    const { generateTrainingPlan } = await import("@/lib/training-plan");
    const { assembleForecastInputs } = await import("@/lib/race/service");
    const { getOpenWeekPlan } = await import("@/lib/week-plan/service");

    await generateTrainingPlan({
      userId: USER,
      raceType: "10k",
      raceDate: ymd(63), // 9-week plan: weekNumber 1..9
    });
    const week = await getOpenWeekPlan(USER);
    expect(week).not.toBeNull();

    // Simulate being 7 weeks into the plan: weeks 1..6 become "prior"
    // blocks relative to the open week's skeletonWeek.
    await db
      .update(schema.weekPlans)
      .set({ skeletonWeek: 7 })
      .where(eq(schema.weekPlans.id, week!.id));

    const adherenceByWeek = [50, 60, 70, 80, 90, 100]; // weekNumber 1..6
    for (let i = 0; i < adherenceByWeek.length; i++) {
      await db
        .update(schema.trainingBlocks)
        .set({ adherencePct: adherenceByWeek[i] })
        .where(
          and(
            eq(schema.trainingBlocks.planId, week!.planId),
            eq(schema.trainingBlocks.weekNumber, i + 1)
          )
        );
    }

    const a = await assembleForecastInputs(USER, null);
    expect(a).not.toBeNull();
    // Only the 4 most recent (weekNumber 6,5,4,3 => 100,90,80,70) count —
    // weeks 1-2 (50,60) must be excluded by the cap.
    const expected = (100 + 90 + 80 + 70) / 4 / 100;
    expect(a!.inputs.adherenceFraction).toBeCloseTo(expected, 10);
  });
});
