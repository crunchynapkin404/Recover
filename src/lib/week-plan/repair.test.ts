import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { periodize, withPurpose } from "@/lib/training-plan";
import { requirePlanSport } from "@/lib/plan-sport";
import type { AvailabilityBlock } from "@/lib/availability/types";
import { applyWeekRepair, computeWeekRepair } from "./repair";
import { materializeWeek } from "./materialize";
import { hoursForMaterialize, weeklyTargetHours } from "./volume";
import { assembleVolumeInputs } from "./volume-inputs";
import { planConstraints } from "./service";
import { dayMins } from "./types";
import type { DaySlot, ScheduledWorkout } from "./types";

// requires Postgres; skips without DATABASE_URL — same guard as the rest of
// week-plan's DB-gated suites (service.test.ts, rollover-volume.test.ts).
const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

const TEST_USER = "test-week-repair-user";
const WEEK_START = "2026-07-20"; // Monday
const SKELETON_WEEK = 2;
const NOW = new Date("2026-07-21T12:00:00Z");

function blk(mins: number): AvailabilityBlock {
  return { start: null, end: null, mins, energy: "full", sports: null };
}

function sw(o: Partial<ScheduledWorkout> = {}): ScheduledWorkout {
  return withPurpose({
    day: 0,
    sport: "Bike",
    type: "Endurance",
    durationMins: 45,
    intensity: "Z1-Z2",
    description: "Easy ride",
    blockIdx: 0,
    ...o,
  });
}

function weekDates(): string[] {
  const out: string[] = [];
  const d = new Date(WEEK_START + "T00:00:00");
  for (let i = 0; i < 7; i++) {
    out.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
        d.getDate()
      ).padStart(2, "0")}`
    );
    d.setDate(d.getDate() + 1);
  }
  return out;
}
const DATES = weekDates();

function emptyDay(date: string): DaySlot {
  const availableBlocks = [blk(90)];
  return {
    date,
    availableBlocks,
    availableMins: dayMins({ availableBlocks }),
    workouts: [],
    status: "rest",
  };
}

/**
 * A week with:
 *  - day 0 (Monday): COMPLETED, carrying real actual load. Must survive
 *    untouched — it's historical fact.
 *  - day 1 (Tuesday): corrupted by the pre-fix compounding scaler — an
 *    absurd 999min duration and a leftover `readinessBase` anchor. Must be
 *    restored and have `readinessBase` cleared.
 *  - days 2-6: plain, untouched rest days, giving materializeWeek room to
 *    place sessions.
 */
function corruptedWeekFixture(): DaySlot[] {
  const days = DATES.map((d) => emptyDay(d));
  days[0] = {
    ...days[0],
    status: "completed",
    workouts: [sw({ day: 0, durationMins: 45 })],
    actualLoad: 50,
  };
  days[1] = {
    ...days[1],
    status: "adapted",
    workouts: [sw({ day: 1, durationMins: 999 })],
    readinessBase: {
      date: days[1].date,
      band: "amber",
      workouts: [sw({ day: 1, durationMins: 1234 })],
    },
  };
  return days;
}

/**
 * Computes what a fresh materializeWeek call produces for these exact
 * `days`' availableBlocks — the same pipeline computeWeekRepair uses
 * internally (assembleVolumeInputs -> weeklyTargetHours ->
 * hoursForMaterialize -> periodize -> materializeWeek), called directly
 * here as the test's oracle. Not a second derivation: it is the identical
 * deterministic call, made twice against identical inputs, which is exactly
 * what proves computeWeekRepair reuses the real pipeline rather than
 * inventing its own answer.
 */
async function expectedFreshWeek(planId: string, days: DaySlot[]) {
  const plan = await db.query.trainingPlans.findFirst({
    where: eq(schema.trainingPlans.id, planId),
  });
  const constraints = planConstraints(plan!.constraints);
  const availableBlocksPerDay = days.map((d) => d.availableBlocks);
  const availabilityHours = days.reduce((s, d) => s + dayMins(d), 0) / 60;

  const volumeInputs = await assembleVolumeInputs(TEST_USER, NOW);
  const target = weeklyTargetHours({
    raceDemandHours: volumeInputs.demand?.available
      ? volumeInputs.demand.weeklyHours
      : null,
    ceilingHours: volumeInputs.level.ceilingHours,
    floorHours: volumeInputs.level.floorHours,
    availabilityHours,
    fallbackHours: constraints.hoursPerWeek,
  });
  const sport = requirePlanSport(constraints.sports?.[0]);
  const derivedBlocks = periodize(
    plan!.weeksTotal,
    plan!.startingCtl ?? 0,
    constraints.daysPerWeek,
    target.hours,
    sport
  );
  const derived =
    derivedBlocks.find((b) => b.weekNumber === SKELETON_WEEK) ??
    derivedBlocks[derivedBlocks.length - 1];

  const r = materializeWeek({
    weekStart: WEEK_START,
    skeleton: {
      weekNumber: derived.weekNumber,
      phase: derived.phase,
      targetLoadTotal: derived.targetLoad,
      targetSessions: derived.targetSessions,
    },
    availableBlocksPerDay,
    prevWeek: null,
    recentBands: [],
    sport,
    hoursPerWeek: hoursForMaterialize(target),
    races: [],
    currentCtl: null,
  });
  return r.week;
}

describe.skipIf(!hasDb)("computeWeekRepair / applyWeekRepair", () => {
  let planId: string;

  beforeAll(async () => {
    await db
      .insert(schema.users)
      .values({
        id: TEST_USER,
        name: "Test Week Repair User",
        email: `${TEST_USER}@example.invalid`,
      })
      .onConflictDoNothing();

    const [plan] = await db
      .insert(schema.trainingPlans)
      .values({
        userId: TEST_USER,
        title: "Test Repair Plan",
        raceType: "century",
        raceDate: "2026-09-13",
        startDate: "2026-07-13",
        weeksTotal: 9,
        currentWeek: SKELETON_WEEK,
        startingCtl: 50,
        status: "active",
        constraints: { daysPerWeek: 4, hoursPerWeek: 8, sports: ["Bike"] },
      })
      .returning();
    planId = plan.id;
  });

  afterAll(async () => {
    await db
      .delete(schema.weekPlans)
      .where(eq(schema.weekPlans.userId, TEST_USER));
    await db
      .delete(schema.trainingPlans)
      .where(eq(schema.trainingPlans.userId, TEST_USER));
    await db.delete(schema.users).where(eq(schema.users.id, TEST_USER));
  });

  beforeEach(async () => {
    await db
      .delete(schema.weekPlans)
      .where(eq(schema.weekPlans.userId, TEST_USER));
  });

  async function seedWeek(days: DaySlot[]): Promise<void> {
    await db.insert(schema.weekPlans).values({
      userId: TEST_USER,
      planId,
      weekStart: WEEK_START,
      skeletonWeek: SKELETON_WEEK,
      days,
      status: "open",
    });
  }

  it("leaves a completed day byte-identical", async () => {
    const days = corruptedWeekFixture();
    await seedWeek(days);

    const repair = await computeWeekRepair(TEST_USER, NOW);
    const day0 = repair!.days[0];

    expect(day0.settled).toBe(true);
    expect(day0.changed).toBe(false);
    expect(day0.after).toEqual(day0.before);
    expect(day0.after.actualLoad).toBe(50);
    expect(day0.after.workouts[0].durationMins).toBe(45);
  });

  it("restores a corrupted planned day to what the shared pipeline produces", async () => {
    const days = corruptedWeekFixture();
    await seedWeek(days);

    const repair = await computeWeekRepair(TEST_USER, NOW);
    const expected = await expectedFreshWeek(planId, days);

    const day1 = repair!.days[1];
    expect(day1.settled).toBe(false);
    expect(day1.changed).toBe(true);
    // The corrupted 999min session must be gone...
    expect(day1.after.workouts.some((w) => w.durationMins === 999)).toBe(false);
    // ...replaced by exactly what materializeWeek independently produces for
    // this slot given the same inputs.
    expect(day1.after.workouts).toEqual(expected.days[1].workouts);
    expect(day1.after.status).toBe(expected.days[1].status);
  });

  it("clears readinessBase on the day it restores", async () => {
    const days = corruptedWeekFixture();
    expect(days[1].readinessBase).toBeDefined(); // sanity: fixture is corrupted
    await seedWeek(days);

    const repair = await computeWeekRepair(TEST_USER, NOW);

    expect(repair!.days[1].after.readinessBase).toBeUndefined();
  });

  it("is idempotent — applying and recomputing makes no further change", async () => {
    const days = corruptedWeekFixture();
    await seedWeek(days);

    const first = await computeWeekRepair(TEST_USER, NOW);
    expect(first!.changed).toBe(true);

    await applyWeekRepair(first!);

    const second = await computeWeekRepair(TEST_USER, NOW);
    expect(second!.changed).toBe(false);
    for (const d of second!.days) expect(d.changed).toBe(false);

    // Applying the (no-op) second computation must not disturb anything
    // either — belt and braces on the idempotency claim.
    await applyWeekRepair(second!);
    const third = await computeWeekRepair(TEST_USER, NOW);
    expect(third!.changed).toBe(false);
  });

  it("returns null for a user with no open week", async () => {
    const repair = await computeWeekRepair("no-such-user-at-all", NOW);
    expect(repair).toBeNull();
  });
});
