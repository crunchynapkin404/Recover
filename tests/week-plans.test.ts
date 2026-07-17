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
  for (const id of [USER, OTHER]) {
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
}

describe.skipIf(!hasDb)("week-plan service", () => {
  beforeAll(async () => {
    const { db, schema } = await import("@/lib/db");
    await cleanupUsers();
    for (const id of [USER, OTHER]) {
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
});
