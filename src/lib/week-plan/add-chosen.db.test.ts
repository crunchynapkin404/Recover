import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { addChosenWorkout, getOpenWeekPlan, removeChosenWorkout } from "./service";
import { isAthleteChosen } from "./placement";
import type { DaySlot } from "./types";
import type { AvailabilityBlock } from "@/lib/availability/types";
import { LIBRARY } from "@/lib/interval/library";
import { durationRangeFor } from "./add-chosen";

// requires Postgres; skips without DATABASE_URL.
const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

const TEST_USER = "test-add-chosen-user";
const WEEK_START = "2026-07-20"; // Monday
const DATES = Array.from({ length: 7 }, (_, i) => {
  const d = new Date(WEEK_START + "T00:00:00");
  d.setDate(d.getDate() + i);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
});

const PICK = LIBRARY.find((w) => w.purpose === "aerobic_base")!;
const MINS = durationRangeFor(PICK.id)!.min;

function blk(mins: number): AvailabilityBlock {
  return { start: null, end: null, mins, energy: "full", sports: null };
}

function emptyDay(date: string, blocks: AvailabilityBlock[] = []): DaySlot {
  return {
    date,
    availableBlocks: blocks,
    availableMins: blocks.reduce((s, b) => s + b.mins, 0),
    workouts: [],
    status: "rest",
  };
}

describe.skipIf(!hasDb)("addChosenWorkout / removeChosenWorkout", () => {
  let planId: string;

  beforeAll(async () => {
    await db
      .insert(schema.users)
      .values({
        id: TEST_USER,
        name: "Test Add Chosen User",
        email: `${TEST_USER}@example.invalid`,
      })
      .onConflictDoNothing();
    const [plan] = await db
      .insert(schema.trainingPlans)
      .values({
        userId: TEST_USER,
        title: "Test Plan",
        raceType: "marathon",
        raceDate: "2026-12-01",
        startDate: "2026-01-01",
        weeksTotal: 16,
        currentWeek: 1,
        status: "active",
      })
      .returning();
    planId = plan.id;
  });

  afterAll(async () => {
    await db.delete(schema.weekPlans).where(eq(schema.weekPlans.userId, TEST_USER));
    await db.delete(schema.trainingPlans).where(eq(schema.trainingPlans.userId, TEST_USER));
    await db.delete(schema.users).where(eq(schema.users.id, TEST_USER));
  });

  beforeEach(async () => {
    await db.delete(schema.weekPlans).where(eq(schema.weekPlans.userId, TEST_USER));
    await db.insert(schema.weekPlans).values({
      userId: TEST_USER,
      planId,
      weekStart: WEEK_START,
      skeletonWeek: 1,
      days: DATES.map((d) => emptyDay(d)),
      status: "open",
    });
  });

  it("places the pick on an empty day with no availability at all", async () => {
    // The whole point: the athlete never touched the availability slider.
    expect(
      await addChosenWorkout(TEST_USER, DATES[3], PICK.id, MINS, DATES[0])
    ).toBe("added");

    const week = await getOpenWeekPlan(TEST_USER);
    const day = week!.days[3];
    expect(day.workouts).toHaveLength(1);
    expect(isAthleteChosen(day.workouts[0])).toBe(true);
    expect(day.workouts[0].durationMins).toBe(MINS);
    expect(day.status).toBe("planned");
    expect(day.availableBlocks).toEqual([]);
  });

  it("writes no availability override", async () => {
    await addChosenWorkout(TEST_USER, DATES[3], PICK.id, MINS, DATES[0]);
    const overrides = await db.query.availabilityOverrides.findMany({
      where: eq(schema.availabilityOverrides.userId, TEST_USER),
    });
    expect(overrides).toEqual([]);
  });

  it("survives a re-read — the placement round-trips through jsonb", async () => {
    await addChosenWorkout(TEST_USER, DATES[3], PICK.id, MINS, DATES[0]);
    const week = await getOpenWeekPlan(TEST_USER);
    expect(week!.days[3].workouts[0].placement).toEqual({
      kind: "athlete",
      choice: {
        workoutId: PICK.id,
        chosenAt: expect.any(String),
      },
    });
  });

  it("refuses server-side even when the UI would not have offered it", async () => {
    expect(
      await addChosenWorkout(TEST_USER, DATES[0], PICK.id, MINS, DATES[3])
    ).toBe("past_day");
  });

  it("refuses a third session on a day", async () => {
    await addChosenWorkout(TEST_USER, DATES[3], PICK.id, MINS, DATES[0]);
    await addChosenWorkout(TEST_USER, DATES[3], PICK.id, MINS, DATES[0]);
    expect(
      await addChosenWorkout(TEST_USER, DATES[3], PICK.id, MINS, DATES[0])
    ).toBe("day_full");
  });

  it("refuses an unknown workout id", async () => {
    expect(
      await addChosenWorkout(TEST_USER, DATES[3], "no-such", MINS, DATES[0])
    ).toBe("invalid");
  });

  it("removes the session and returns the day to rest", async () => {
    await addChosenWorkout(TEST_USER, DATES[3], PICK.id, MINS, DATES[0]);
    expect(await removeChosenWorkout(TEST_USER, DATES[3], PICK.id)).toBe("removed");
    const week = await getOpenWeekPlan(TEST_USER);
    expect(week!.days[3].workouts).toEqual([]);
    expect(week!.days[3].status).toBe("rest");
  });

  it("refuses to remove something that is not there", async () => {
    expect(await removeChosenWorkout(TEST_USER, DATES[3], PICK.id)).toBe("invalid");
  });
});
