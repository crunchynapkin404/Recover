// src/lib/week-plan/service.ts — DB orchestration for the living week.
// All plan logic lives in the pure engines (materialize.ts / adapt-day.ts);
// this layer only loads state, runs an engine, and persists the result.
import { and, asc, desc, eq, gte, lt } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { racesForWeek, currentCtl } from "@/lib/race/service";
import { materializeWeek } from "./materialize";
import { adaptDay } from "./adapt-day";
import { prefillAvailability } from "./availability";
import { isQuality } from "./types";
import type { AdjustmentRecord, Band, DaySlot } from "./types";

export type AdjustmentRow = typeof schema.planAdjustments.$inferSelect;

export interface OpenWeekPlan {
  id: string;
  planId: string;
  weekStart: string;
  skeletonWeek: number;
  days: DaySlot[];
}

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

interface PlanConstraints {
  daysPerWeek: number;
  hoursPerWeek: number;
  sports: string[];
}

function planConstraints(constraints: unknown): PlanConstraints {
  const c = (constraints ?? {}) as {
    daysPerWeek?: number;
    hoursPerWeek?: number;
    sports?: string[];
  };
  return {
    daysPerWeek: c.daysPerWeek ?? 5,
    hoursPerWeek: c.hoursPerWeek ?? 8,
    sports: c.sports?.length ? c.sports : ["Run"],
  };
}

async function activePlan(userId: string) {
  return db.query.trainingPlans.findFirst({
    where: and(
      eq(schema.trainingPlans.userId, userId),
      eq(schema.trainingPlans.status, "active")
    ),
    orderBy: desc(schema.trainingPlans.createdAt),
  });
}

/** Last 7 readiness bands, oldest first; missing rows count as calibrating. */
async function recentBands(userId: string): Promise<Band[]> {
  const rows = await db.query.dailyMetrics.findMany({
    where: eq(schema.dailyMetrics.userId, userId),
    orderBy: desc(schema.dailyMetrics.date),
    limit: 7,
  });
  return rows.reverse().map((r) => (r.band ?? "calibrating") as Band);
}

async function saveAdjustments(
  weekPlanId: string,
  adjustments: AdjustmentRecord[]
): Promise<void> {
  for (const a of adjustments) {
    await db.insert(schema.planAdjustments).values({ weekPlanId, ...a });
  }
}

function weekActuals(days: DaySlot[]): {
  actualLoad: number;
  actualSessions: number;
} {
  return {
    actualLoad: days.reduce((s, d) => s + (d.actualLoad ?? 0), 0),
    actualSessions: days.filter((d) => d.status === "completed").length,
  };
}

export async function getOpenWeekPlan(
  userId: string
): Promise<OpenWeekPlan | null> {
  const row = await db.query.weekPlans.findFirst({
    where: and(
      eq(schema.weekPlans.userId, userId),
      eq(schema.weekPlans.status, "open")
    ),
    orderBy: desc(schema.weekPlans.weekStart),
  });
  if (!row) return null;
  return {
    id: row.id,
    planId: row.planId,
    weekStart: row.weekStart,
    skeletonWeek: row.skeletonWeek,
    days: row.days as DaySlot[],
  };
}

export async function listAdjustments(
  weekPlanId: string
): Promise<AdjustmentRow[]> {
  return db.query.planAdjustments.findMany({
    where: eq(schema.planAdjustments.weekPlanId, weekPlanId),
    orderBy: asc(schema.planAdjustments.createdAt),
  });
}

export async function rolloverWeekPlan(
  userId: string,
  now = new Date()
): Promise<"rolled" | "skipped"> {
  const plan = await activePlan(userId);
  if (!plan) return "skipped";

  const weekStart = mondayOf(now);
  const existing = await db.query.weekPlans.findFirst({
    where: and(
      eq(schema.weekPlans.userId, userId),
      eq(schema.weekPlans.weekStart, weekStart)
    ),
  });
  let supersededPlan = false;
  if (existing) {
    if (existing.planId === plan.id) return "skipped"; // idempotency
    // The plan was regenerated mid-week: the archived plan's week would
    // shadow the new plan until next Monday. Replace it (the user-week
    // unique index means the old row must go, adjustments cascade).
    await db
      .delete(schema.weekPlans)
      .where(eq(schema.weekPlans.id, existing.id));
    supersededPlan = true;
  }

  // 1. Close every still-open week and write its actuals back to the
  //    skeleton block (same formula as the weekly review's adherence).
  let prevWeek: { actualLoad: number; adherencePct: number } | null = null;
  const openRows = await db.query.weekPlans.findMany({
    where: and(
      eq(schema.weekPlans.userId, userId),
      eq(schema.weekPlans.status, "open")
    ),
    orderBy: asc(schema.weekPlans.weekStart),
  });
  for (const row of openRows) {
    const days = row.days as DaySlot[];
    const { actualLoad, actualSessions } = weekActuals(days);
    const block = await db.query.trainingBlocks.findFirst({
      where: and(
        eq(schema.trainingBlocks.planId, row.planId),
        eq(schema.trainingBlocks.weekNumber, row.skeletonWeek)
      ),
    });
    const adherencePct = block?.targetLoadTotal
      ? Math.round((actualLoad / block.targetLoadTotal) * 100)
      : 0;
    if (block) {
      await db
        .update(schema.trainingBlocks)
        .set({ actualLoad, actualSessions, adherencePct })
        .where(eq(schema.trainingBlocks.id, block.id));
    }
    await db
      .update(schema.weekPlans)
      .set({ status: "closed", updatedAt: now })
      .where(eq(schema.weekPlans.id, row.id));
    prevWeek = { actualLoad, adherencePct }; // rows are ascending: latest wins
  }

  // 2. Gather inputs for the new week.
  const skeleton =
    (await db.query.trainingBlocks.findFirst({
      where: and(
        eq(schema.trainingBlocks.planId, plan.id),
        eq(schema.trainingBlocks.weekNumber, plan.currentWeek)
      ),
    })) ??
    // Plan ran out of blocks: hold the last week's skeleton.
    (await db.query.trainingBlocks.findFirst({
      where: eq(schema.trainingBlocks.planId, plan.id),
      orderBy: desc(schema.trainingBlocks.weekNumber),
    }));
  if (!skeleton) return "skipped";

  const lastWeekRow = await db.query.weekPlans.findFirst({
    where: and(
      eq(schema.weekPlans.userId, userId),
      eq(schema.weekPlans.weekStart, addDaysYmd(weekStart, -7))
    ),
  });
  const constraints = planConstraints(plan.constraints);
  const today = localYmd(now);
  const availabilityMins = prefillAvailability({
    hoursPerWeek: constraints.hoursPerWeek,
    daysPerWeek: constraints.daysPerWeek,
    lastWeekMins: lastWeekRow
      ? (lastWeekRow.days as DaySlot[]).map((d) => d.availableMins)
      : null,
    // Calendar prefill is applied in the UI/action layer where a human
    // confirms it, never inside the automatic rollover.
    busyMinsPerDay: null,
    // Days already behind us have no availability: a mid-week start (new
    // plan or "Plan this week") must not invent workouts in the past. On
    // the normal Monday rollover this is a no-op.
  }).map((mins, i) => (addDaysYmd(weekStart, i) < today ? 0 : mins));

  // 3. Materialize.
  const [races, ctlNow] = await Promise.all([
    racesForWeek(userId, weekStart),
    currentCtl(userId),
  ]);
  const r = materializeWeek({
    weekStart,
    skeleton: {
      weekNumber: skeleton.weekNumber,
      phase: skeleton.phase,
      targetLoadTotal: skeleton.targetLoadTotal ?? 0,
      targetSessions: skeleton.targetSessions ?? 0,
    },
    availabilityMins,
    prevWeek,
    recentBands: await recentBands(userId),
    raceType: plan.raceType,
    sports: constraints.sports,
    hoursPerWeek: constraints.hoursPerWeek,
    races,
    currentCtl: ctlNow,
  });

  // 4. Persist.
  const [inserted] = await db
    .insert(schema.weekPlans)
    .values({
      userId,
      planId: plan.id,
      weekStart,
      skeletonWeek: skeleton.weekNumber,
      days: r.week.days,
      status: "open",
    })
    .returning();
  if (supersededPlan) {
    r.adjustments.unshift({
      date: today,
      trigger: "weekly_rollover",
      action: "swapped",
      before: [],
      after: [],
      reason: "plan changed — this week re-materialized from the new plan",
    });
  }
  await saveAdjustments(inserted.id, r.adjustments);
  return "rolled";
}

export async function runDailyAdaptation(
  userId: string,
  now = new Date()
): Promise<"adapted" | "skipped"> {
  const week = await getOpenWeekPlan(userId);
  if (!week) return "skipped";
  const today = localYmd(now);
  if (!week.days.some((d) => d.date === today)) return "skipped";

  // Yesterday completion: match any provider's activity on yesterday's
  // local date with the planned sport (matching is bookkeeping, not AI
  // context, so Strava rows count here).
  const yesterdayYmd = addDaysYmd(today, -1);
  const ySlot = week.days.find((d) => d.date === yesterdayYmd);
  let yesterdayCompleted: boolean | null = null;
  let matched: { id: string; load: number | null } | null = null;
  if (
    ySlot?.workout &&
    (ySlot.status === "planned" ||
      ySlot.status === "moved" ||
      ySlot.status === "adapted")
  ) {
    const activity = await db.query.activities.findFirst({
      where: and(
        eq(schema.activities.userId, userId),
        eq(schema.activities.sport, ySlot.workout.sport),
        gte(schema.activities.startDate, new Date(yesterdayYmd + "T00:00:00")),
        lt(schema.activities.startDate, new Date(today + "T00:00:00"))
      ),
      orderBy: desc(schema.activities.startDate),
    });
    if (activity) {
      yesterdayCompleted = true;
      matched = { id: activity.id, load: activity.load };
    } else {
      yesterdayCompleted = false;
    }
  }

  const metric = await db.query.dailyMetrics.findFirst({
    where: and(
      eq(schema.dailyMetrics.userId, userId),
      eq(schema.dailyMetrics.date, today)
    ),
  });
  const band = (metric?.band ?? "calibrating") as Band;

  const result = adaptDay({
    week: {
      weekStart: week.weekStart,
      skeletonWeek: week.skeletonWeek,
      days: week.days,
    },
    today,
    band,
    yesterdayCompleted,
  });

  if (matched) {
    const slot = result.week.days.find((d) => d.date === yesterdayYmd);
    if (slot) {
      slot.activityId = matched.id;
      slot.actualLoad = matched.load ?? undefined;
    }
  }

  const changed =
    result.adjustments.length > 0 ||
    JSON.stringify(result.week.days) !== JSON.stringify(week.days);
  if (!changed) return "skipped";

  await db
    .update(schema.weekPlans)
    .set({ days: result.week.days, updatedAt: now })
    .where(eq(schema.weekPlans.id, week.id));
  await saveAdjustments(week.id, result.adjustments);
  return "adapted";
}

function fmtHours(mins: number): string {
  const h = mins / 60;
  return Number.isInteger(h) ? String(h) : h.toFixed(1);
}

export async function applyAvailability(
  userId: string,
  mins: number[]
): Promise<"applied" | "no_open_week"> {
  const week = await getOpenWeekPlan(userId);
  if (!week || mins.length !== 7) return "no_open_week";
  const plan = await db.query.trainingPlans.findFirst({
    where: eq(schema.trainingPlans.id, week.planId),
  });
  if (!plan) return "no_open_week";

  const skeleton =
    (await db.query.trainingBlocks.findFirst({
      where: and(
        eq(schema.trainingBlocks.planId, week.planId),
        eq(schema.trainingBlocks.weekNumber, week.skeletonWeek)
      ),
    })) ?? null;
  if (!skeleton) return "no_open_week";

  // Days already lived (completed/missed) keep their slot untouched; the
  // rest of the week rematerializes against the new availability.
  const locked = week.days.map(
    (d) => d.status === "completed" || d.status === "missed"
  );
  const availabilityMins = mins.map((m, i) => (locked[i] ? 0 : m));

  const prevBlock = await db.query.trainingBlocks.findFirst({
    where: and(
      eq(schema.trainingBlocks.planId, week.planId),
      eq(schema.trainingBlocks.weekNumber, week.skeletonWeek - 1)
    ),
  });
  const constraints = planConstraints(plan.constraints);

  const [races, ctlNow] = await Promise.all([
    racesForWeek(userId, week.weekStart),
    currentCtl(userId),
  ]);
  const r = materializeWeek({
    weekStart: week.weekStart,
    skeleton: {
      weekNumber: skeleton.weekNumber,
      phase: skeleton.phase,
      targetLoadTotal: skeleton.targetLoadTotal ?? 0,
      targetSessions: skeleton.targetSessions ?? 0,
    },
    availabilityMins,
    prevWeek:
      prevBlock?.actualLoad != null
        ? {
            actualLoad: prevBlock.actualLoad,
            adherencePct: prevBlock.adherencePct ?? 0,
          }
        : null,
    recentBands: await recentBands(userId),
    raceType: plan.raceType,
    sports: constraints.sports,
    hoursPerWeek: constraints.hoursPerWeek,
    races,
    currentCtl: ctlNow,
  });

  const merged = r.week.days.map((d, i) => (locked[i] ? week.days[i] : d));
  const oldTotal = week.days.reduce((s, d) => s + d.availableMins, 0);
  const newTotal = merged.reduce((s, d) => s + d.availableMins, 0);

  const now = new Date();
  await db
    .update(schema.weekPlans)
    .set({ days: merged, updatedAt: now })
    .where(eq(schema.weekPlans.id, week.id));
  const today = localYmd(now);
  await saveAdjustments(week.id, [
    {
      date: week.days.some((d) => d.date === today) ? today : week.weekStart,
      trigger: "availability_change",
      action: "redistributed",
      before: week.days.filter((_, i) => !locked[i]),
      after: merged.filter((_, i) => !locked[i]),
      reason: `availability updated: ${fmtHours(oldTotal)}h→${fmtHours(newTotal)}h`,
    },
  ]);

  // Re-check today against the new week (its own persistence + logging).
  await runDailyAdaptation(userId, now);
  return "applied";
}

/**
 * Coach-initiated move: same adjacency/availability checks as adaptDay's
 * move — the target day must be free, fit the session, and (for quality
 * sessions) not sit next to another quality day.
 */
export async function moveWorkout(
  userId: string,
  fromDate: string,
  toDate: string
): Promise<"moved" | "no_open_week" | "invalid"> {
  const week = await getOpenWeekPlan(userId);
  if (!week) return "no_open_week";
  const fromIdx = week.days.findIndex((d) => d.date === fromDate);
  const toIdx = week.days.findIndex((d) => d.date === toDate);
  if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return "invalid";

  const from = week.days[fromIdx];
  const to = week.days[toIdx];
  if (!from.workout) return "invalid";
  if (from.status === "completed" || from.status === "missed") return "invalid";
  if (to.workout !== null) return "invalid";
  if (to.status === "completed" || to.status === "missed") return "invalid";
  if (to.status === "race") return "invalid";
  if (to.availableMins < from.workout.durationMins) return "invalid";

  const days = week.days.map((d) => ({
    ...d,
    workout: d.workout ? { ...d.workout } : null,
  }));
  const workout = days[fromIdx].workout!;
  days[fromIdx] = {
    ...days[fromIdx],
    workout: null,
    status: "rest",
    movedFrom: undefined,
  };
  if (
    isQuality(workout) &&
    (isQuality(days[toIdx - 1]?.workout ?? null) ||
      isQuality(days[toIdx + 1]?.workout ?? null))
  ) {
    return "invalid";
  }
  const before = [
    { ...from, workout: { ...from.workout } },
    { ...to, workout: null },
  ];
  days[toIdx] = {
    ...days[toIdx],
    workout,
    status: "moved",
    movedFrom: fromDate,
  };

  await db
    .update(schema.weekPlans)
    .set({ days, updatedAt: new Date() })
    .where(eq(schema.weekPlans.id, week.id));
  await saveAdjustments(week.id, [
    {
      date: fromDate,
      trigger: "availability_change",
      action: "moved",
      before,
      after: [{ ...days[fromIdx] }, { ...days[toIdx] }],
      reason: `moved by coach: ${fromDate} → ${toDate}`,
    },
  ]);
  return "moved";
}

/** Coach-initiated swap: both sessions must fit each other's day. */
export async function swapWorkouts(
  userId: string,
  fromDate: string,
  toDate: string
): Promise<"swapped" | "no_open_week" | "invalid"> {
  const week = await getOpenWeekPlan(userId);
  if (!week) return "no_open_week";
  const fromIdx = week.days.findIndex((d) => d.date === fromDate);
  const toIdx = week.days.findIndex((d) => d.date === toDate);
  if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return "invalid";

  const from = week.days[fromIdx];
  const to = week.days[toIdx];
  if (!from.workout || !to.workout) return "invalid";
  for (const d of [from, to]) {
    if (d.status === "completed" || d.status === "missed") return "invalid";
  }
  if (
    to.availableMins < from.workout.durationMins ||
    from.availableMins < to.workout.durationMins
  ) {
    return "invalid";
  }

  const days = week.days.map((d) => ({
    ...d,
    workout: d.workout ? { ...d.workout } : null,
  }));
  const before = [
    { ...from, workout: { ...from.workout } },
    { ...to, workout: { ...to.workout } },
  ];
  const fromWorkout = days[fromIdx].workout!;
  days[fromIdx] = { ...days[fromIdx], workout: days[toIdx].workout };
  days[toIdx] = { ...days[toIdx], workout: fromWorkout };

  await db
    .update(schema.weekPlans)
    .set({ days, updatedAt: new Date() })
    .where(eq(schema.weekPlans.id, week.id));
  await saveAdjustments(week.id, [
    {
      date: fromDate,
      trigger: "availability_change",
      action: "swapped",
      before,
      after: [{ ...days[fromIdx] }, { ...days[toIdx] }],
      reason: `swapped by coach: ${fromDate} ↔ ${toDate}`,
    },
  ]);
  return "swapped";
}
