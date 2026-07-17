// src/lib/week-plan/service.ts — DB orchestration for the living week.
// All plan logic lives in the pure engines (materialize.ts / adapt-day.ts);
// this layer only loads state, runs an engine, and persists the result.
import { and, asc, desc, eq, gte, lt } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { materializeWeek } from "./materialize";
import { adaptDay } from "./adapt-day";
import { prefillAvailability } from "./availability";
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
  if (existing) return "skipped"; // idempotency: one row per user-week

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
  const availabilityMins = prefillAvailability({
    hoursPerWeek: constraints.hoursPerWeek,
    daysPerWeek: constraints.daysPerWeek,
    lastWeekMins: lastWeekRow
      ? (lastWeekRow.days as DaySlot[]).map((d) => d.availableMins)
      : null,
    // Calendar prefill is applied in the UI/action layer where a human
    // confirms it, never inside the automatic rollover.
    busyMinsPerDay: null,
  });

  // 3. Materialize.
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
