import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getOpenWeekPlan, runDailyAdaptation } from "@/lib/week-plan/service";
import { weekActuals } from "@/lib/week-plan/actuals";
import { withPurpose } from "@/lib/training-plan";
import type { DaySlot, ScheduledWorkout } from "@/lib/week-plan/types";
import type { AvailabilityBlock } from "@/lib/availability/types";

// requires Postgres; skips without DATABASE_URL.
const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

const TEST_USER = "test-week-actuals-booking-user";
const WEEK_START = "2026-07-27"; // Monday — the live week from the spec
const DATES = [
  "2026-07-27",
  "2026-07-28",
  "2026-07-29",
  "2026-07-30",
  "2026-07-31",
  "2026-08-01",
  "2026-08-02",
];

function blk(mins: number): AvailabilityBlock {
  return { start: null, end: null, mins, energy: "full", sports: null };
}

function sw(o: Partial<ScheduledWorkout> = {}): ScheduledWorkout {
  return withPurpose({
    day: 0,
    sport: "Bike",
    type: "Endurance",
    durationMins: 60,
    intensity: "Z1-Z2",
    description: "Easy ride",
    blockIdx: 0,
    ...o,
  });
}

function emptyDay(date: string): DaySlot {
  return {
    date,
    availableBlocks: [blk(120)],
    availableMins: 120,
    workouts: [],
    status: "rest",
  };
}

/** The live week's shape: Bike sessions Monday, Tuesday and Saturday. */
function fixtureDays(): DaySlot[] {
  const days = DATES.map(emptyDay);
  for (const i of [0, 1, 5]) {
    days[i] = { ...days[i], status: "completed", workouts: [sw()] };
  }
  return days;
}

async function addRide(
  ymd: string,
  load: number,
  externalId: string,
  sport = "Ride"
) {
  await db.insert(schema.activities).values({
    userId: TEST_USER,
    provider: "intervals_icu",
    externalId,
    startDate: new Date(`${ymd}T09:00:00`),
    startDateLocal: new Date(`${ymd}T09:00:00`),
    sport,
    durationS: 3600,
    load,
  });
}

async function seedWeek(days: DaySlot[], planId: string) {
  await db.insert(schema.weekPlans).values({
    userId: TEST_USER,
    planId,
    weekStart: WEEK_START,
    skeletonWeek: 1,
    days,
    status: "open",
    effectiveTarget: 244,
  });
}

describe.skipIf(!hasDb)("runDailyAdaptation books every past day", () => {
  let planId: string;

  beforeAll(async () => {
    await db
      .insert(schema.users)
      .values({
        id: TEST_USER,
        name: "Test Week Actuals Booking User",
        email: `${TEST_USER}@example.invalid`,
      })
      .onConflictDoNothing();

    const [plan] = await db
      .insert(schema.trainingPlans)
      .values({
        userId: TEST_USER,
        title: "Test Plan",
        raceType: "gran_fondo",
        raceDate: "2026-09-13",
        startDate: "2026-07-27",
        weeksTotal: 8,
        currentWeek: 1,
        status: "active",
      })
      .returning();
    planId = plan.id;

    await db.insert(schema.trainingBlocks).values({
      planId,
      weekNumber: 1,
      phase: "base",
      targetLoadTotal: 244,
      targetSessions: 3,
      workouts: [],
    });
  });

  afterAll(async () => {
    await db
      .delete(schema.activities)
      .where(eq(schema.activities.userId, TEST_USER));
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
      .delete(schema.activities)
      .where(eq(schema.activities.userId, TEST_USER));
    await db
      .delete(schema.weekPlans)
      .where(eq(schema.weekPlans.userId, TEST_USER));
  });

  it("books a day the athlete marked done", async () => {
    await seedWeek(fixtureDays(), planId);
    await addRide("2026-07-28", 155, "mark-done-ride");

    await runDailyAdaptation(TEST_USER, new Date("2026-07-29T06:00:00"));

    const week = await getOpenWeekPlan(TEST_USER);
    const tue = week!.days.find((d) => d.date === "2026-07-28")!;
    expect(tue.status).toBe("completed");
    expect(tue.actualLoad).toBe(155);
  });

  it("reproduces the live week at 783 rather than 314", async () => {
    await seedWeek(fixtureDays(), planId);
    await addRide("2026-07-27", 184, "live-a");
    await addRide("2026-07-28", 155, "live-b");
    await addRide("2026-07-30", 63, "live-c");
    await addRide("2026-07-30", 67, "live-d");
    await addRide("2026-08-01", 314, "live-e");

    // Sunday: `now` must fall inside the week or runDailyAdaptation skips.
    await runDailyAdaptation(TEST_USER, new Date("2026-08-02T06:00:00"));

    const week = await getOpenWeekPlan(TEST_USER);
    expect(weekActuals(week!.days).actualLoad).toBe(783);
  });

  it("books a cross-sport day as unplanned and marks the session missed", async () => {
    const days = fixtureDays();
    days[1] = {
      ...days[1],
      status: "planned",
      workouts: [sw({ sport: "Run" })],
    };
    await seedWeek(days, planId);
    // No connections rows exist for this user, so activitiesSettled is true
    // and the missed judgement is allowed to run.
    await addRide("2026-07-28", 136, "cross-sport-ride");

    await runDailyAdaptation(TEST_USER, new Date("2026-07-29T06:00:00"));

    const week = await getOpenWeekPlan(TEST_USER);
    const tue = week!.days.find((d) => d.date === "2026-07-28")!;
    expect(tue.status).toBe("missed");
    expect(tue.unplannedLoad).toBe(136);
    expect(tue.actualLoad).toBeUndefined();
    expect(weekActuals(week!.days).actualLoad).toBe(136);
  });

  it("books an activity that synced two days late", async () => {
    await seedWeek(fixtureDays(), planId);
    await runDailyAdaptation(TEST_USER, new Date("2026-07-29T06:00:00"));

    await addRide("2026-07-28", 155, "late-ride");
    await runDailyAdaptation(TEST_USER, new Date("2026-07-31T06:00:00"));

    const week = await getOpenWeekPlan(TEST_USER);
    const tue = week!.days.find((d) => d.date === "2026-07-28")!;
    expect((tue.actualLoad ?? 0) + (tue.unplannedLoad ?? 0)).toBe(155);
  });

  it("is a no-op on the second run", async () => {
    await seedWeek(fixtureDays(), planId);
    await addRide("2026-07-28", 155, "idem-ride");

    await runDailyAdaptation(TEST_USER, new Date("2026-07-29T06:00:00"));
    const second = await runDailyAdaptation(
      TEST_USER,
      new Date("2026-07-29T06:00:00")
    );

    expect(second).toBe("skipped");
  });

  it("does not book today", async () => {
    await seedWeek(fixtureDays(), planId);
    await addRide("2026-07-29", 90, "today-ride");

    await runDailyAdaptation(TEST_USER, new Date("2026-07-29T18:00:00"));

    const week = await getOpenWeekPlan(TEST_USER);
    const wed = week!.days.find((d) => d.date === "2026-07-29")!;
    expect(wed.actualLoad).toBeUndefined();
    expect(wed.unplannedLoad).toBeUndefined();
  });
});
