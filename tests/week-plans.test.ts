import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";

/**
 * Integration tests for the v0.9.2 week-plan service layer. Same idiom as
 * tests/body-prefs.test.ts: env-guarded DB URL, describe.skipIf(!hasDb),
 * per-test cleanup deleting the created users cascade-style. The engines
 * (materializeWeek/adaptDay) are covered by pure fixtures in
 * src/lib/week-plan/*.test.ts — these tests cover persistence: rollover
 * idempotency, closing last week with adherence write-back, the morning
 * adaptation run, and availability re-application.
 */

const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

const USER = "test-week-plans-user";
const OTHER = "test-week-plans-no-plan-user";
const GEN = "test-week-plans-generate-user";

function localYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function mondayOf(d: Date): string {
  const day = (d.getDay() + 6) % 7; // Mon=0
  const m = new Date(d);
  m.setDate(d.getDate() - day);
  return localYmd(m);
}

function addDaysYmd(ymd: string, n: number): string {
  const d = new Date(ymd + "T00:00:00");
  d.setDate(d.getDate() + n);
  return localYmd(d);
}

const weekStart = mondayOf(new Date());
const lastWeekStart = addDaysYmd(weekStart, -7);
const todayYmd = localYmd(new Date());

let planId: string;

function restDay(date: string) {
  return {
    date,
    availableMins: 60,
    workout: null,
    status: "rest" as const,
  };
}

/** A seeded open week for the current week: Intervals today, rest elsewhere. */
function seededDays() {
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDaysYmd(weekStart, i);
    if (date === todayYmd) {
      return {
        date,
        availableMins: 60,
        workout: {
          day: i,
          sport: "Run",
          type: "Intervals",
          durationMins: 50,
          intensity: "Z4-Z5",
          description: "Interval session",
        },
        status: "planned" as const,
      };
    }
    return restDay(date);
  });
}

async function cleanupUsers() {
  const { db, schema } = await import("@/lib/db");
  for (const id of [USER, OTHER, GEN]) {
    await db.delete(schema.users).where(eq(schema.users.id, id));
  }
}

async function resetState() {
  const { db, schema } = await import("@/lib/db");
  await db.delete(schema.weekPlans).where(eq(schema.weekPlans.userId, USER));
  await db
    .delete(schema.dailyMetrics)
    .where(eq(schema.dailyMetrics.userId, USER));
  await db.delete(schema.activities).where(eq(schema.activities.userId, USER));
  await db
    .update(schema.trainingBlocks)
    .set({ actualLoad: null, actualSessions: null, adherencePct: null })
    .where(eq(schema.trainingBlocks.planId, planId));
  // The Task-8 pipeline test runs the real weekly review, which advances
  // currentWeek and stores a review message (its at-most-once marker).
  await db
    .update(schema.trainingPlans)
    .set({ currentWeek: 1 })
    .where(eq(schema.trainingPlans.id, planId));
  const threads = await db.query.chatThreads.findMany({
    where: eq(schema.chatThreads.userId, USER),
  });
  for (const t of threads) {
    await db
      .delete(schema.chatMessages)
      .where(eq(schema.chatMessages.threadId, t.id));
  }
  await db
    .delete(schema.chatThreads)
    .where(eq(schema.chatThreads.userId, USER));
}

describe.skipIf(!hasDb)("week-plan service", () => {
  beforeAll(async () => {
    const { db, schema } = await import("@/lib/db");
    await cleanupUsers();
    for (const id of [USER, OTHER, GEN]) {
      await db
        .insert(schema.users)
        .values({
          id,
          name: "WeekPlansTest",
          email: `${id}@example.invalid`,
          role: "member",
        })
        .onConflictDoNothing();
    }
    const [plan] = await db
      .insert(schema.trainingPlans)
      .values({
        userId: USER,
        title: "Test marathon plan",
        raceType: "marathon",
        raceDate: addDaysYmd(weekStart, 12 * 7),
        startDate: lastWeekStart,
        weeksTotal: 12,
        currentWeek: 1,
        status: "active",
        constraints: { daysPerWeek: 5, hoursPerWeek: 8, sports: ["Run"] },
      })
      .returning();
    planId = plan.id;
    await db.insert(schema.trainingBlocks).values({
      planId,
      weekNumber: 1,
      phase: "build",
      targetLoadTotal: 400,
      targetSessions: 5,
      workouts: [],
    });
  });

  afterAll(cleanupUsers);

  beforeEach(resetState);

  it("rollover materializes an open week from the skeleton block", async () => {
    const { rolloverWeekPlan, getOpenWeekPlan } =
      await import("@/lib/week-plan/service");
    expect(await rolloverWeekPlan(USER)).toBe("rolled");
    const week = await getOpenWeekPlan(USER);
    expect(week).not.toBeNull();
    expect(week!.days).toHaveLength(7);
    expect(week!.weekStart).toBe(weekStart);
    expect(week!.skeletonWeek).toBe(1);
  });

  it("rollover is idempotent — second call same week is skipped", async () => {
    const { rolloverWeekPlan } = await import("@/lib/week-plan/service");
    await rolloverWeekPlan(USER);
    expect(await rolloverWeekPlan(USER)).toBe("skipped");
  });

  it("rollover closes the previous open week and writes adherence to its block", async () => {
    const { db, schema } = await import("@/lib/db");
    const { rolloverWeekPlan } = await import("@/lib/week-plan/service");

    const prevDays = Array.from({ length: 7 }, (_, i) => {
      const date = addDaysYmd(lastWeekStart, i);
      if (i === 0) {
        return {
          date,
          availableMins: 60,
          workout: {
            day: 0,
            sport: "Run",
            type: "Endurance",
            durationMins: 45,
            intensity: "Z1-Z2",
            description: "Easy run",
          },
          status: "completed" as const,
          actualLoad: 50,
        };
      }
      return restDay(date);
    });
    await db.insert(schema.weekPlans).values({
      userId: USER,
      planId,
      weekStart: lastWeekStart,
      skeletonWeek: 1,
      days: prevDays,
      status: "open",
    });

    expect(await rolloverWeekPlan(USER)).toBe("rolled");

    const prev = await db.query.weekPlans.findFirst({
      where: and(
        eq(schema.weekPlans.userId, USER),
        eq(schema.weekPlans.weekStart, lastWeekStart)
      ),
    });
    expect(prev?.status).toBe("closed");

    const block = await db.query.trainingBlocks.findFirst({
      where: and(
        eq(schema.trainingBlocks.planId, planId),
        eq(schema.trainingBlocks.weekNumber, 1)
      ),
    });
    expect(block?.actualLoad).toBe(50);
    expect(block?.actualSessions).toBe(1);
    expect(block?.adherencePct).toBe(Math.round((50 / 400) * 100));
  });

  it("runDailyAdaptation on a red morning adapts today and logs an adjustment", async () => {
    const { db, schema } = await import("@/lib/db");
    const { runDailyAdaptation, getOpenWeekPlan, listAdjustments } =
      await import("@/lib/week-plan/service");

    await db.insert(schema.weekPlans).values({
      userId: USER,
      planId,
      weekStart,
      skeletonWeek: 1,
      days: seededDays(),
      status: "open",
    });
    await db.insert(schema.dailyMetrics).values({
      userId: USER,
      date: todayYmd,
      readiness: 25,
      band: "red",
    });

    expect(await runDailyAdaptation(USER)).toBe("adapted");

    const week = await getOpenWeekPlan(USER);
    const today = week!.days.find((d) => d.date === todayYmd);
    expect(today?.workout?.type).toBe("Recovery");
    const adjustments = await listAdjustments(week!.id);
    expect(
      adjustments.some(
        (a) => a.trigger === "low_readiness" && a.date === todayYmd
      )
    ).toBe(true);
  });

  it("runDailyAdaptation without dailyMetrics row is availability-only (skipped when nothing to do)", async () => {
    const { db, schema } = await import("@/lib/db");
    const { runDailyAdaptation } = await import("@/lib/week-plan/service");

    await db.insert(schema.weekPlans).values({
      userId: USER,
      planId,
      weekStart,
      skeletonWeek: 1,
      days: seededDays(),
      status: "open",
    });

    // No dailyMetrics → band "calibrating": readiness rules must not fire,
    // and today's 50min Intervals fit the 60min slot, so nothing changes.
    expect(await runDailyAdaptation(USER)).toBe("skipped");
  });

  it("applyAvailability rematerializes only non-completed days and logs availability_change", async () => {
    const {
      rolloverWeekPlan,
      applyAvailability,
      getOpenWeekPlan,
      listAdjustments,
    } = await import("@/lib/week-plan/service");

    await rolloverWeekPlan(USER);
    expect(await applyAvailability(USER, [0, 60, 60, 60, 60, 120, 150])).toBe(
      "applied"
    );

    const week = await getOpenWeekPlan(USER);
    expect(week).not.toBeNull();
    const monday = week!.days[0];
    expect(monday.availableMins).toBe(0);
    expect(monday.workout).toBeNull();
    const adjustments = await listAdjustments(week!.id);
    expect(adjustments.some((a) => a.trigger === "availability_change")).toBe(
      true
    );
  });

  it("applyAvailability without an open week reports no_open_week", async () => {
    const { applyAvailability } = await import("@/lib/week-plan/service");
    expect(await applyAvailability(USER, [0, 60, 60, 60, 60, 120, 150])).toBe(
      "no_open_week"
    );
  });

  it("no active plan → everything is a no-op", async () => {
    const { rolloverWeekPlan, runDailyAdaptation } =
      await import("@/lib/week-plan/service");
    expect(await rolloverWeekPlan(OTHER)).toBe("skipped");
    expect(await runDailyAdaptation(OTHER)).toBe("skipped");
  });

  it("generateWeeklyReview leaves an open week_plans row (rollover wired)", async () => {
    const { db, schema } = await import("@/lib/db");
    const { generateWeeklyReview } = await import("@/lib/weekly-review");
    const { getOpenWeekPlan } = await import("@/lib/week-plan/service");

    // Make the review due now (due-since-slot guard).
    const now = new Date();
    await db
      .insert(schema.notificationPrefs)
      .values({
        userId: USER,
        weeklyReviewDay: now.getDay(),
        weeklyReviewHour: now.getHours(),
      })
      .onConflictDoNothing();
    // The review requires ≥3 activities in its window.
    for (let i = 0; i < 3; i++) {
      const startDate = new Date(now);
      startDate.setDate(startDate.getDate() - (i + 1));
      await db.insert(schema.activities).values({
        userId: USER,
        provider: "intervals_icu",
        externalId: `week-plans-review-${i}-${Date.now()}`,
        startDate,
        sport: "Run",
        name: `Run ${i}`,
        load: 60,
      });
    }

    await generateWeeklyReview(USER);

    const week = await getOpenWeekPlan(USER);
    expect(week).not.toBeNull();
    expect(week!.days).toHaveLength(7);
  });

  it("moveWorkout moves a session between days and logs the coach adjustment", async () => {
    const { db, schema } = await import("@/lib/db");
    const { moveWorkout, getOpenWeekPlan, listAdjustments } =
      await import("@/lib/week-plan/service");

    await db.insert(schema.weekPlans).values({
      userId: USER,
      planId,
      weekStart,
      skeletonWeek: 1,
      days: seededDays(),
      status: "open",
    });

    const toDate = seededDays().find((d) => d.date !== todayYmd)!.date;
    expect(await moveWorkout(USER, todayYmd, toDate)).toBe("moved");

    const week = await getOpenWeekPlan(USER);
    const from = week!.days.find((d) => d.date === todayYmd)!;
    const to = week!.days.find((d) => d.date === toDate)!;
    expect(from.workout).toBeNull();
    expect(from.status).toBe("rest");
    expect(to.workout?.type).toBe("Intervals");
    expect(to.status).toBe("moved");
    expect(to.movedFrom).toBe(todayYmd);

    const adjustments = await listAdjustments(week!.id);
    expect(
      adjustments.some(
        (a) =>
          a.trigger === "availability_change" &&
          a.action === "moved" &&
          a.reason === `moved by coach: ${todayYmd} → ${toDate}`
      )
    ).toBe(true);
  });

  it("moveWorkout validates: empty origin or occupied target is invalid", async () => {
    const { db, schema } = await import("@/lib/db");
    const { moveWorkout } = await import("@/lib/week-plan/service");

    await db.insert(schema.weekPlans).values({
      userId: USER,
      planId,
      weekStart,
      skeletonWeek: 1,
      days: seededDays(),
      status: "open",
    });

    const restDate = seededDays().find((d) => d.date !== todayYmd)!.date;
    // Origin has no workout.
    expect(await moveWorkout(USER, restDate, todayYmd)).toBe("invalid");
    // Target already has a workout.
    const otherRest = seededDays().filter((d) => d.date !== todayYmd)[1].date;
    expect(await moveWorkout(USER, otherRest, todayYmd)).toBe("invalid");
    // No open week at all.
    expect(await moveWorkout(OTHER, todayYmd, restDate)).toBe("no_open_week");
  });

  it("moveWorkout refuses to move a workout onto a race-day slot", async () => {
    const { db, schema } = await import("@/lib/db");
    const { moveWorkout, getOpenWeekPlan } =
      await import("@/lib/week-plan/service");

    const raceDate = seededDays().find((d) => d.date !== todayYmd)!.date;
    const days = seededDays().map((d) =>
      d.date === raceDate
        ? { ...d, workout: null, status: "race" as const, raceName: "Test 10K" }
        : d
    );
    await db.insert(schema.weekPlans).values({
      userId: USER,
      planId,
      weekStart,
      skeletonWeek: 1,
      days,
      status: "open",
    });

    expect(await moveWorkout(USER, todayYmd, raceDate)).toBe("invalid");

    const week = await getOpenWeekPlan(USER);
    const race = week!.days.find((d) => d.date === raceDate)!;
    expect(race.status).toBe("race");
    expect(race.raceName).toBe("Test 10K");
    expect(race.workout).toBeNull();
    const source = week!.days.find((d) => d.date === todayYmd)!;
    expect(source.workout?.type).toBe("Intervals");
    expect(source.status).toBe("planned");
  });

  it("swapWorkouts exchanges two days when both fit", async () => {
    const { db, schema } = await import("@/lib/db");
    const { swapWorkouts, getOpenWeekPlan } =
      await import("@/lib/week-plan/service");

    const days = seededDays();
    const otherDate = days.find((d) => d.date !== todayYmd)!.date;
    const withSecond = days.map((d) =>
      d.date === otherDate
        ? {
            ...d,
            workout: {
              day: 0,
              sport: "Run",
              type: "Endurance",
              durationMins: 40,
              intensity: "Z1-Z2",
              description: "Easy run",
            },
            status: "planned" as const,
          }
        : d
    );
    await db.insert(schema.weekPlans).values({
      userId: USER,
      planId,
      weekStart,
      skeletonWeek: 1,
      days: withSecond,
      status: "open",
    });

    expect(await swapWorkouts(USER, todayYmd, otherDate)).toBe("swapped");
    const week = await getOpenWeekPlan(USER);
    expect(week!.days.find((d) => d.date === todayYmd)!.workout?.type).toBe(
      "Endurance"
    );
    expect(week!.days.find((d) => d.date === otherDate)!.workout?.type).toBe(
      "Intervals"
    );
  });

  it("mid-week rollover gives already-past days zero availability and rest", async () => {
    const { rolloverWeekPlan, getOpenWeekPlan } =
      await import("@/lib/week-plan/service");

    // Fixed clock: Thursday 2026-08-06 → weekStart Monday 2026-08-03.
    const thursday = new Date("2026-08-06T12:00:00");
    expect(await rolloverWeekPlan(USER, thursday)).toBe("rolled");

    const week = await getOpenWeekPlan(USER);
    expect(week!.weekStart).toBe("2026-08-03");
    // Mon–Wed are gone: no availability, no invented workouts.
    for (const d of week!.days.slice(0, 3)) {
      expect(d.availableMins).toBe(0);
      expect(d.workout).toBeNull();
      expect(d.status).toBe("rest");
    }
    // The remaining days still carry the week's sessions.
    expect(week!.days.slice(3).some((d) => d.workout !== null)).toBe(true);
  });

  it("generateTrainingPlan materializes the first week immediately", async () => {
    const { generateTrainingPlan } = await import("@/lib/training-plan");
    const { getOpenWeekPlan } = await import("@/lib/week-plan/service");

    await generateTrainingPlan({
      userId: GEN,
      raceType: "marathon",
      raceDate: addDaysYmd(weekStart, 10 * 7),
      daysPerWeek: 5,
      hoursPerWeek: 8,
    });

    const week = await getOpenWeekPlan(GEN);
    expect(week).not.toBeNull();
    expect(week!.weekStart).toBe(weekStart);
    expect(week!.days).toHaveLength(7);
  });

  it("regenerating a plan replaces the archived plan's open week", async () => {
    const { generateTrainingPlan } = await import("@/lib/training-plan");
    const { getOpenWeekPlan } = await import("@/lib/week-plan/service");

    const first = await generateTrainingPlan({
      userId: GEN,
      raceType: "marathon",
      raceDate: addDaysYmd(weekStart, 10 * 7),
    });
    const firstWeek = await getOpenWeekPlan(GEN);
    expect(firstWeek?.planId).toBe(first.planId);

    const second = await generateTrainingPlan({
      userId: GEN,
      raceType: "half marathon",
      raceDate: addDaysYmd(weekStart, 12 * 7),
    });

    const week = await getOpenWeekPlan(GEN);
    expect(week).not.toBeNull();
    expect(week!.planId).toBe(second.planId);
    expect(week!.planId).not.toBe(first.planId);
  });

  it("markDayDone completes a planned session without inventing load", async () => {
    const { db, schema } = await import("@/lib/db");
    const { markDayDone, getOpenWeekPlan } =
      await import("@/lib/week-plan/service");

    await db.insert(schema.weekPlans).values({
      userId: USER,
      planId,
      weekStart,
      skeletonWeek: 1,
      days: seededDays(),
      status: "open",
    });

    expect(await markDayDone(USER, todayYmd)).toBe("completed");

    const week = await getOpenWeekPlan(USER);
    const day = week!.days.find((d) => d.date === todayYmd)!;
    expect(day.status).toBe("completed");
    // The athlete's word is a status, not data: no load, no activity, and
    // the planned session itself is left intact.
    expect(day.actualLoad).toBeUndefined();
    expect(day.activityId).toBeUndefined();
    expect(day.workout?.type).toBe("Intervals");
  });

  it("markDayDone leaves the week's load-based adherence untouched", async () => {
    const { db, schema } = await import("@/lib/db");
    const { markDayDone, rolloverWeekPlan } =
      await import("@/lib/week-plan/service");

    await db.insert(schema.weekPlans).values({
      userId: USER,
      planId,
      weekStart: lastWeekStart,
      skeletonWeek: 1,
      days: seededDays().map((d) => ({
        ...d,
        date: addDaysYmd(d.date, -7),
      })),
      status: "open",
    });

    const markedDate = addDaysYmd(todayYmd, -7);
    expect(await markDayDone(USER, markedDate)).toBe("completed");

    // Closing that week writes adherence back to its block. Nothing synced,
    // so actual load — and therefore adherence — must still be zero.
    await rolloverWeekPlan(USER);
    const block = await db.query.trainingBlocks.findFirst({
      where: and(
        eq(schema.trainingBlocks.planId, planId),
        eq(schema.trainingBlocks.weekNumber, 1)
      ),
    });
    expect(block?.actualLoad).toBe(0);
    expect(block?.adherencePct).toBe(0);
    // The tick is still recorded as a session that happened.
    expect(block?.actualSessions).toBe(1);
  });

  it("markDayDone refuses rest days, race days and repeat ticks", async () => {
    const { db, schema } = await import("@/lib/db");
    const { markDayDone } = await import("@/lib/week-plan/service");

    const days = seededDays();
    const restDate = days.find((d) => d.date !== todayYmd)!.date;
    const raceDate = days.filter((d) => d.date !== todayYmd)[1].date;
    await db.insert(schema.weekPlans).values({
      userId: USER,
      planId,
      weekStart,
      skeletonWeek: 1,
      days: days.map((d) =>
        d.date === raceDate
          ? { ...d, status: "race" as const, raceName: "Test race" }
          : d
      ),
      status: "open",
    });

    expect(await markDayDone(USER, restDate)).toBe("invalid");
    expect(await markDayDone(USER, raceDate)).toBe("invalid");
    expect(await markDayDone(USER, todayYmd)).toBe("completed");
    expect(await markDayDone(USER, todayYmd)).toBe("invalid");
  });

  it("markDayDone without an open week reports no_open_week", async () => {
    const { markDayDone } = await import("@/lib/week-plan/service");
    expect(await markDayDone(USER, todayYmd)).toBe("no_open_week");
  });
});
