// src/lib/week-plan/service.ts — DB orchestration for the living week.
// All plan logic lives in the pure engines (materialize.ts / adapt-day.ts);
// this layer only loads state, runs an engine, and persists the result.
import { and, asc, desc, eq, gte, lt, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { racesForWeek, currentCtl } from "@/lib/race/service";
import { materializeWeek } from "./materialize";
import { adaptDay } from "./adapt-day";
import { replanWeek } from "./replan";
import { resolveWeek } from "@/lib/availability/resolve";
import { dayMins } from "./types";
import type { AdjustmentRecord, Band, DaySlot } from "./types";
import { findBlockFor } from "./slots";
import type { AvailabilityBlock } from "@/lib/availability/types";

export type AdjustmentRow = typeof schema.planAdjustments.$inferSelect;

export interface OpenWeekPlan {
  id: string;
  planId: string;
  weekStart: string;
  skeletonWeek: number;
  days: DaySlot[];
  /** materializeWeek's effectiveLoad for this week — null on pre-fix rows. */
  effectiveTarget: number | null;
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

/**
 * Legacy adapter for callers that still only speak one number per day (the
 * coach tool and the availability-change form haven't been rebuilt around
 * blocks yet). Wraps each day's minutes into a single untimed block, or no
 * blocks at all when the day is empty, so they can still call
 * `applyAvailability`'s block-based signature.
 */
export function minsToAvailableBlocks(mins: number[]): AvailabilityBlock[][] {
  return mins.map((m) =>
    m > 0
      ? [
          {
            start: null,
            end: null,
            mins: m,
            energy: "normal" as const,
            sports: null,
          },
        ]
      : []
  );
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
    effectiveTarget: row.effectiveTarget,
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
    // The week's persisted effective target (post-taper, post-hours-budget)
    // wins over the block's un-tapered skeleton value — a taper week closed
    // out at 100% of its actual (small) target must not score ~45% just
    // because the skeleton block still holds the pre-taper number. Rows
    // written before this column existed fall back to the block value.
    const target = row.effectiveTarget ?? block?.targetLoadTotal ?? null;
    const adherencePct = target ? Math.round((actualLoad / target) * 100) : 0;
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

  const constraints = planConstraints(plan.constraints);
  const today = localYmd(now);
  const dates = Array.from({ length: 7 }, (_, i) => addDaysYmd(weekStart, i));
  const resolved = await resolveWeek(userId, dates);
  // Days already behind us have no availability: a mid-week start must not
  // invent workouts in the past. On the normal Monday rollover this is a
  // no-op.
  const availableBlocksPerDay = dates.map((d) =>
    d < today ? [] : (resolved.get(d) ?? [])
  );

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
    availableBlocksPerDay,
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
      effectiveTarget: r.effectiveLoad,
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
  const ySlotWorkout = ySlot?.workouts[0] ?? null;
  let yesterdayCompleted: boolean | null = null;
  let matched: { id: string; load: number | null } | null = null;
  if (
    ySlotWorkout &&
    ySlot != null &&
    (ySlot.status === "planned" ||
      ySlot.status === "moved" ||
      ySlot.status === "adapted")
  ) {
    // COALESCE at the SQL level, not just in JS: a plain
    // gte(startDateLocal, ...) would silently drop every pre-migration row
    // (startDateLocal is a nullable, not-yet-backfilled column — NULL >= x
    // is NULL/false in SQL), excluding them from the window entirely rather
    // than falling back to startDate.
    const activity = await db.query.activities.findFirst({
      where: and(
        eq(schema.activities.userId, userId),
        eq(schema.activities.sport, ySlotWorkout.sport),
        gte(
          sql`coalesce(${schema.activities.startDateLocal}, ${schema.activities.startDate})`,
          new Date(yesterdayYmd + "T00:00:00")
        ),
        lt(
          sql`coalesce(${schema.activities.startDateLocal}, ${schema.activities.startDate})`,
          new Date(today + "T00:00:00")
        )
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
  blocksPerDay: AvailabilityBlock[][]
): Promise<"applied" | "no_open_week"> {
  const week = await getOpenWeekPlan(userId);
  if (!week || blocksPerDay.length !== 7) return "no_open_week";

  // replanWeek keeps completed/missed days exactly as they are — no need to
  // zero their incoming availability here.
  const resolved = new Map(week.days.map((d, i) => [d.date, blocksPerDay[i]]));
  const r = replanWeek(
    {
      weekStart: week.weekStart,
      skeletonWeek: week.skeletonWeek,
      days: week.days,
    },
    resolved
  );

  const oldTotal = week.days.reduce((s, d) => s + dayMins(d), 0);
  const newTotal = r.week.days.reduce((s, d) => s + dayMins(d), 0);
  const now = new Date();

  await db
    .update(schema.weekPlans)
    .set({ days: r.week.days, availabilityConfirmedAt: now, updatedAt: now })
    .where(eq(schema.weekPlans.id, week.id));

  const today = localYmd(now);
  await saveAdjustments(week.id, [
    ...r.adjustments,
    {
      date: week.days.some((d) => d.date === today) ? today : week.weekStart,
      trigger: "availability_change",
      action: "redistributed",
      before: [],
      after: [],
      reason: `availability updated: ${fmtHours(oldTotal)}h→${fmtHours(newTotal)}h`,
    },
  ]);

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
  // A day can now genuinely hold two sessions (MAX_SESSIONS_PER_DAY). This
  // signature only names a day, not which of its sessions to move, so a
  // multi-session source is refused rather than guessed at — and moving one
  // session out from under the other would also strand the survivor with a
  // stale blockIdx. (The destination check below already refuses any
  // occupied day, so this only bites on the source side, but is kept
  // explicit in case that check ever loosens.)
  if (from.workouts.length > 1) return "invalid";
  if (to.workouts.length > 1) return "invalid";
  const fromWorkoutSrc = from.workouts[0] ?? null;
  if (!fromWorkoutSrc) return "invalid";
  if (from.status === "completed" || from.status === "missed") return "invalid";
  if (to.workouts.length > 0) return "invalid";
  if (to.status === "completed" || to.status === "missed") return "invalid";
  if (to.status === "race") return "invalid";

  const days = week.days.map((d) => ({
    ...d,
    workouts: d.workouts.map((w) => ({ ...w })),
  }));
  const workout = days[fromIdx].workouts[0]!;
  days[fromIdx] = {
    ...days[fromIdx],
    workouts: [],
    status: "rest",
    movedFrom: undefined,
  };

  // The destination's own workouts are already empty (checked above), so
  // nothing on that day is taken; admits() picks the block, size, sport,
  // energy ceiling and quality adjacency all in one test — not a day-level
  // "does some block fit?" check.
  const blockIdx = findBlockFor(days, toIdx, workout, new Set());
  if (blockIdx == null) return "invalid";

  const before = [
    { ...from, workouts: from.workouts.map((w) => ({ ...w })) },
    { ...to, workouts: [] },
  ];
  days[toIdx] = {
    ...days[toIdx],
    workouts: [{ ...workout, blockIdx }],
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
  // Same conservative refusal as moveWorkout: swapping a specific session
  // out of a multi-session day needs the caller to say which one, which
  // this signature cannot express, so refuse rather than guess and strand
  // the other session with a stale blockIdx.
  if (from.workouts.length > 1 || to.workouts.length > 1) return "invalid";
  const fromWorkoutSrc = from.workouts[0] ?? null;
  const toWorkoutSrc = to.workouts[0] ?? null;
  if (!fromWorkoutSrc || !toWorkoutSrc) return "invalid";
  for (const d of [from, to]) {
    if (d.status === "completed" || d.status === "missed") return "invalid";
  }

  const days = week.days.map((d) => ({
    ...d,
    workouts: d.workouts.map((w) => ({ ...w })),
  }));
  const before = [
    { ...from, workouts: from.workouts.map((w) => ({ ...w })) },
    { ...to, workouts: to.workouts.map((w) => ({ ...w })) },
  ];

  // Each session must land in a block on its NEW day that actually admits
  // it, not the index it happened to carry from its old one. Both days are
  // cleared first so a session's own departure is never mistaken for an
  // occupant, then placed one at a time so the second placement sees the
  // first's final position — matters only when fromDate and toDate are
  // adjacent, which is exactly when admits()'s quality-adjacency check
  // needs the real post-swap neighbour, not the pre-swap one.
  days[fromIdx] = { ...days[fromIdx], workouts: [] };
  days[toIdx] = { ...days[toIdx], workouts: [] };

  const toBlockIdx = findBlockFor(days, toIdx, fromWorkoutSrc, new Set());
  if (toBlockIdx == null) return "invalid";
  days[toIdx] = {
    ...days[toIdx],
    workouts: [{ ...fromWorkoutSrc, blockIdx: toBlockIdx }],
  };

  const fromBlockIdx = findBlockFor(days, fromIdx, toWorkoutSrc, new Set());
  if (fromBlockIdx == null) return "invalid";
  days[fromIdx] = {
    ...days[fromIdx],
    workouts: [{ ...toWorkoutSrc, blockIdx: fromBlockIdx }],
  };

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

/**
 * Athlete-initiated "Mark done" (2a). Flips a planned day to completed
 * without inventing anything: no actualLoad, no activityId, no synthetic
 * activity row. Adherence is load-based (actualLoad / target), so a manual
 * tick moves the week's session count and nothing else — if the ride later
 * syncs, adaptDay attaches the real load and the day is already where it
 * belongs.
 *
 * Refuses days that have no workout (nothing to complete), days already
 * completed or missed, and race days, which the race flow owns.
 */
export async function markDayDone(
  userId: string,
  date: string
): Promise<"completed" | "no_open_week" | "invalid"> {
  const week = await getOpenWeekPlan(userId);
  if (!week) return "no_open_week";
  const idx = week.days.findIndex((d) => d.date === date);
  if (idx === -1) return "invalid";

  const day = week.days[idx];
  if (day.workouts.length === 0) return "invalid";
  if (day.status === "completed" || day.status === "missed") return "invalid";
  if (day.status === "race") return "invalid";

  const days = week.days.map((d) => ({
    ...d,
    workouts: d.workouts.map((w) => ({ ...w })),
  }));
  days[idx] = { ...days[idx], status: "completed" };

  await db
    .update(schema.weekPlans)
    .set({ days, updatedAt: new Date() })
    .where(eq(schema.weekPlans.id, week.id));
  return "completed";
}
