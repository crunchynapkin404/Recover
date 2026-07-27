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

function blocksFor(mins: number) {
  return mins > 0
    ? [
        {
          start: null,
          end: null,
          mins,
          energy: "normal" as const,
          sports: null,
        },
      ]
    : [];
}

function restDay(date: string) {
  return {
    date,
    availableBlocks: blocksFor(60),
    availableMins: 60,
    workouts: [],
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
        availableBlocks: blocksFor(60),
        availableMins: 60,
        workouts: [
          {
            day: i,
            sport: "Run",
            type: "Intervals",
            durationMins: 50,
            intensity: "Z4-Z5",
            description: "Interval session",
            blockIdx: 0,
          },
        ],
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
    // A standard week for USER: rolloverWeekPlan now resolves availability
    // from availability_defaults instead of synthesizing it from plan
    // constraints, so tests exercising the real rollover need a real
    // standard week seeded (a user with none configured gets an all-rest
    // week, by design — see resolveWeek).
    await db.insert(schema.availabilityDefaults).values(
      Array.from({ length: 7 }, (_, weekday) => ({
        userId: USER,
        weekday,
        blocks: [
          {
            start: null,
            end: null,
            mins: 90,
            energy: "normal" as const,
            sports: null,
          },
        ],
      }))
    );
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
          availableBlocks: blocksFor(60),
          availableMins: 60,
          workouts: [
            {
              day: 0,
              sport: "Run",
              type: "Endurance",
              durationMins: 45,
              intensity: "Z1-Z2",
              description: "Easy run",
              blockIdx: 0,
            },
          ],
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
    expect(today?.workouts[0]?.type).toBe("Recovery");
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

  it("applyAvailability replans only non-completed days and logs availability_change", async () => {
    const {
      rolloverWeekPlan,
      applyAvailability,
      getOpenWeekPlan,
      listAdjustments,
    } = await import("@/lib/week-plan/service");

    await rolloverWeekPlan(USER);
    expect(
      await applyAvailability(
        USER,
        [0, 60, 60, 60, 60, 120, 150].map(blocksFor)
      )
    ).toBe("applied");

    const week = await getOpenWeekPlan(USER);
    expect(week).not.toBeNull();
    const monday = week!.days[0];
    expect(monday.availableMins).toBe(0);
    expect(monday.workouts).toHaveLength(0);
    const adjustments = await listAdjustments(week!.id);
    expect(adjustments.some((a) => a.trigger === "availability_change")).toBe(
      true
    );
  });

  it("applyAvailability without an open week reports no_open_week", async () => {
    const { applyAvailability } = await import("@/lib/week-plan/service");
    expect(
      await applyAvailability(
        USER,
        [0, 60, 60, 60, 60, 120, 150].map(blocksFor)
      )
    ).toBe("no_open_week");
  });

  it("no active plan → everything is a no-op", async () => {
    const { rolloverWeekPlan, runDailyAdaptation } =
      await import("@/lib/week-plan/service");
    expect(await rolloverWeekPlan(OTHER)).toBe("skipped");
    expect(await runDailyAdaptation(OTHER)).toBe("skipped");
  });

  // Regression for the migration in drizzle/0031_backfill_availability_defaults.sql:
  // an active-plan user with zero availability_defaults rows used to roll
  // over into a silently all-rest week (resolveWeek returns [] for every
  // weekday with no default). Deliberately does NOT hand-seed
  // availability_defaults — that would mask exactly the bug this proves is
  // fixed. Instead it applies the real, committed migration file verbatim
  // (the actual fix) against a user left in the pre-migration broken state,
  // then asserts the product-level consequence: the resulting week is not
  // all-rest.
  it("a user with an active plan and no availability_defaults gets a real week once the standard-week backfill runs", async () => {
    const { db, schema } = await import("@/lib/db");
    const { sql } = await import("drizzle-orm");
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { rolloverWeekPlan, getOpenWeekPlan } =
      await import("@/lib/week-plan/service");

    const NODEFAULTS = "test-week-plans-no-defaults-user";
    try {
      await db
        .insert(schema.users)
        .values({
          id: NODEFAULTS,
          name: "No Defaults Test",
          email: `${NODEFAULTS}@example.invalid`,
          role: "member",
        })
        .onConflictDoNothing();

      const [plan] = await db
        .insert(schema.trainingPlans)
        .values({
          userId: NODEFAULTS,
          title: "No-defaults plan",
          raceType: "marathon",
          raceDate: addDaysYmd(weekStart, 12 * 7),
          startDate: lastWeekStart,
          weeksTotal: 12,
          currentWeek: 1,
          status: "active",
          constraints: { daysPerWeek: 4, hoursPerWeek: 8, sports: ["Run"] },
        })
        .returning();
      await db.insert(schema.trainingBlocks).values({
        planId: plan.id,
        weekNumber: 1,
        phase: "build",
        targetLoadTotal: 400,
        targetSessions: 4,
        workouts: [],
      });

      // The best available record of what this athlete actually had: a
      // closed prior week, training on its last 4 days (Thu–Sun), exactly
      // the profile the migration derives a standard week from. No
      // availability_defaults rows exist for this user yet.
      await db.insert(schema.weekPlans).values({
        userId: NODEFAULTS,
        planId: plan.id,
        weekStart: lastWeekStart,
        skeletonWeek: 1,
        status: "closed",
        days: Array.from({ length: 7 }, (_, i) => {
          const date = addDaysYmd(lastWeekStart, i);
          const trainingDay = i >= 3;
          return {
            date,
            availableBlocks: blocksFor(trainingDay ? 120 : 0),
            availableMins: trainingDay ? 120 : 0,
            workouts: [],
            status: "rest" as const,
          };
        }),
      });

      const before = await db.query.availabilityDefaults.findMany({
        where: eq(schema.availabilityDefaults.userId, NODEFAULTS),
      });
      expect(before).toHaveLength(0);

      // Apply the actual committed migration SQL verbatim — the fix under
      // test, not a hand-rolled equivalent.
      const migrationPath = fileURLToPath(
        new URL(
          "../drizzle/0031_backfill_availability_defaults.sql",
          import.meta.url
        )
      );
      await db.execute(sql.raw(readFileSync(migrationPath, "utf8")));

      const after = await db.query.availabilityDefaults.findMany({
        where: eq(schema.availabilityDefaults.userId, NODEFAULTS),
      });
      expect(after).toHaveLength(7);

      expect(await rolloverWeekPlan(NODEFAULTS)).toBe("rolled");
      const week = await getOpenWeekPlan(NODEFAULTS);
      expect(week).not.toBeNull();
      // The product-level consequence: not every day materialized as rest.
      expect(week!.days.every((d) => d.status === "rest")).toBe(false);
    } finally {
      // users cascades to trainingPlans/trainingBlocks/weekPlans/
      // availabilityDefaults — same cascade-style cleanup as the rest of
      // this file.
      await db.delete(schema.users).where(eq(schema.users.id, NODEFAULTS));
    }
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
    expect(from.workouts).toHaveLength(0);
    expect(from.status).toBe("rest");
    expect(to.workouts[0]?.type).toBe("Intervals");
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
        ? { ...d, workouts: [], status: "race" as const, raceName: "Test 10K" }
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
    expect(race.workouts).toHaveLength(0);
    const source = week!.days.find((d) => d.date === todayYmd)!;
    expect(source.workouts[0]?.type).toBe("Intervals");
    expect(source.status).toBe("planned");
  });

  it("moveWorkout refuses a target whose OWN block (not a roomier sibling) is too small", async () => {
    const { db, schema } = await import("@/lib/db");
    const { moveWorkout, getOpenWeekPlan } =
      await import("@/lib/week-plan/service");

    // The workout occupies blockIdx 0 wherever it lands (carried across
    // days unchanged — a later task's concern). The target's block 0 is
    // only 10min, far short of the 50min Intervals session; its block 1
    // is a roomy 120min. A day-level "does some block fit?" check would
    // wrongly admit this move.
    const toDate = seededDays().find((d) => d.date !== todayYmd)!.date;
    const days = seededDays().map((d) =>
      d.date === toDate
        ? {
            ...d,
            availableBlocks: [
              {
                start: null,
                end: null,
                mins: 10,
                energy: "normal" as const,
                sports: null,
              },
              {
                start: null,
                end: null,
                mins: 120,
                energy: "normal" as const,
                sports: null,
              },
            ],
            availableMins: 130,
          }
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

    expect(await moveWorkout(USER, todayYmd, toDate)).toBe("invalid");

    const week = await getOpenWeekPlan(USER);
    const source = week!.days.find((d) => d.date === todayYmd)!;
    expect(source.workouts[0]?.type).toBe("Intervals");
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
            workouts: [
              {
                day: 0,
                sport: "Run",
                type: "Endurance",
                durationMins: 40,
                intensity: "Z1-Z2",
                description: "Easy run",
                blockIdx: 0,
              },
            ],
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
    expect(week!.days.find((d) => d.date === todayYmd)!.workouts[0]?.type).toBe(
      "Endurance"
    );
    expect(
      week!.days.find((d) => d.date === otherDate)!.workouts[0]?.type
    ).toBe("Intervals");
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
      expect(d.workouts).toHaveLength(0);
      expect(d.status).toBe("rest");
    }
    // The remaining days still carry the week's sessions.
    expect(week!.days.slice(3).some((d) => d.workouts.length > 0)).toBe(true);
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
    expect(day.workouts[0]?.type).toBe("Intervals");
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

  it("runDailyAdaptation matches yesterday's completion via startDateLocal when it crosses the UTC day boundary", async () => {
    const { db, schema } = await import("@/lib/db");
    const { runDailyAdaptation, getOpenWeekPlan } =
      await import("@/lib/week-plan/service");

    // Fix "now" to a mid-week Wednesday of the already-seeded current week
    // so yesterday (Tuesday) is guaranteed to fall inside `weekStart..+6`
    // regardless of what real-world weekday the suite runs on.
    const wednesday = addDaysYmd(weekStart, 2);
    const now = new Date(wednesday + "T12:00:00");
    const tuesday = addDaysYmd(weekStart, 1);

    const days = Array.from({ length: 7 }, (_, i) => {
      const date = addDaysYmd(weekStart, i);
      if (date === tuesday) {
        return {
          date,
          availableBlocks: blocksFor(60),
          availableMins: 60,
          workouts: [
            {
              day: i,
              sport: "Run",
              type: "Endurance",
              durationMins: 45,
              intensity: "Z1-Z2",
              description: "Easy run",
              blockIdx: 0,
            },
          ],
          status: "planned" as const,
        };
      }
      return restDay(date);
    });
    await db.insert(schema.weekPlans).values({
      userId: USER,
      planId,
      weekStart,
      skeletonWeek: 1,
      days,
      status: "open",
    });

    // The activity's true UTC instant already rolled into Wednesday
    // (00:20), but the athlete's local wall-clock time was still Tuesday
    // night (23:40) — startDateLocal keeps it on the correct calendar day.
    const tuesdayMidnight = new Date(tuesday + "T00:00:00").getTime();
    const [activity] = await db
      .insert(schema.activities)
      .values({
        userId: USER,
        provider: "manual",
        externalId: `week8-boundary-${Date.now()}`,
        sport: "Run",
        startDate: new Date(tuesdayMidnight + 24 * 3_600_000 + 20 * 60_000),
        startDateLocal: new Date(
          tuesdayMidnight + 23 * 3_600_000 + 40 * 60_000
        ),
        load: 42,
      })
      .returning();

    expect(await runDailyAdaptation(USER, now)).toBe("adapted");

    const week = await getOpenWeekPlan(USER);
    const yesterdaySlot = week!.days.find((d) => d.date === tuesday)!;
    expect(yesterdaySlot.activityId).toBe(activity.id);
    expect(yesterdaySlot.actualLoad).toBe(42);
  });
});
