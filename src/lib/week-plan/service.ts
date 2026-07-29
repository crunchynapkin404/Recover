// src/lib/week-plan/service.ts — DB orchestration for the living week.
// All plan logic lives in the pure engines (materialize.ts / adapt-day.ts);
// this layer only loads state, runs an engine, and persists the result.
import { and, asc, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { racesForWeek, currentCtl } from "@/lib/race/service";
import { materializeWeek } from "./materialize";
import { adaptDay } from "./adapt-day";
import { replanWeek } from "./replan";
import { resolveWeek } from "@/lib/availability/resolve";
import { dayMins } from "./types";
import type { AdjustmentRecord, Band, DaySlot } from "./types";
import { findBlockFor } from "./slots";
import { providerSportAliases } from "@/lib/canonical-sport";
import type { AvailabilityBlock } from "@/lib/availability/types";
import { periodize } from "@/lib/training-plan";
import { assembleVolumeInputs } from "./volume-inputs";
import { hoursForMaterialize, weeklyTargetHours } from "./volume";

export type AdjustmentRow = typeof schema.planAdjustments.$inferSelect;

export interface OpenWeekPlan {
  id: string;
  planId: string;
  weekStart: string;
  skeletonWeek: number;
  days: DaySlot[];
  /** materializeWeek's effectiveLoad for this week — null on pre-fix rows. */
  effectiveTarget: number | null;
  /** Set once the athlete (or the coach, on their behalf) confirms this week's availability. */
  availabilityConfirmedAt: Date | null;
  /** Set once this week's availability nudge has actually been pushed. */
  availabilityPromptedAt: Date | null;
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

export function planConstraints(constraints: unknown): PlanConstraints {
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
    // unplannedLoad is real training stress too (a rest-day bonus ride still
    // shows up in the athlete's legs) — it must count toward the week's
    // total exactly as actualLoad does. The two fields only differ in
    // whether they're allowed to trigger a replan; they're equal for
    // adherence and for next week's ramp-clamp target.
    actualLoad: days.reduce(
      (s, d) => s + (d.actualLoad ?? 0) + (d.unplannedLoad ?? 0),
      0
    ),
    // Sessions, not days: a completed day can hold two of them. markDayDone
    // refuses a day with no workouts and preserves the ones it has, so
    // summing is exact rather than an estimate.
    actualSessions: days
      .filter((d) => d.status === "completed")
      .reduce((s, d) => s + d.workouts.length, 0),
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
    availabilityConfirmedAt: row.availabilityConfirmedAt,
    availabilityPromptedAt: row.availabilityPromptedAt,
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

  // Derive this week's hours target rather than reading a number typed once
  // at plan creation. With no event demand and no measured ceiling this
  // returns `constraints.hoursPerWeek` — today's behaviour, unchanged.
  const volumeInputs = await assembleVolumeInputs(userId, now);
  const availabilityHours =
    availableBlocksPerDay.reduce(
      (s, blocks) => s + dayMins({ availableBlocks: blocks }),
      0
    ) / 60;
  const target = weeklyTargetHours({
    raceDemandHours: volumeInputs.demand?.weeklyHours ?? null,
    ceilingHours: volumeInputs.level.ceilingHours,
    floorHours: volumeInputs.level.floorHours,
    availabilityHours,
    fallbackHours: constraints.hoursPerWeek,
  });

  // Recomputed fresh, never read as authority — a stored target is exactly
  // how `hoursPerWeek` went stale in the first place.
  const derivedBlocks = periodize(
    plan.weeksTotal,
    plan.startingCtl ?? 0,
    constraints.daysPerWeek,
    target.hours,
    plan.raceType,
    constraints.sports
  );
  const derived =
    derivedBlocks.find((b) => b.weekNumber === plan.currentWeek) ??
    derivedBlocks[derivedBlocks.length - 1];

  // 3. Materialize.
  const [races, ctlNow] = await Promise.all([
    racesForWeek(userId, weekStart),
    currentCtl(userId),
  ]);
  const r = materializeWeek({
    weekStart,
    skeleton: {
      weekNumber: derived.weekNumber,
      phase: derived.phase,
      targetLoadTotal: derived.targetLoad,
      targetSessions: derived.targetSessions,
    },
    availableBlocksPerDay,
    prevWeek,
    recentBands: await recentBands(userId),
    raceType: plan.raceType,
    sports: constraints.sports,
    hoursPerWeek: hoursForMaterialize(target),
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

/**
 * Books an activity's load onto a day. Work the plan did not ask for goes
 * to `unplannedLoad`, which counts toward the week's actuals but never
 * triggers a replan — an extra easy hour on a rest day must not cost you a
 * session later in the week.
 *
 * A day that DID have a planned session books the whole activity's load as
 * that session's `actualLoad`, even when the activity ran long (e.g. a
 * planned 60min ride that turned into a 3hr group ride): there is no
 * expected-load figure on a `PlannedWorkout` to diff against (only duration
 * + a free-text intensity band), so splitting "the planned part" from "the
 * excess" would mean inventing an unspecified estimate rather than reading
 * one. The invariant this function exists to protect — no session is ever
 * removed for running over on load — holds either way: nothing here (or in
 * adaptDay) removes a session because of accumulated load.
 *
 * Pure, and exported for its tests: the only thing it decides is which
 * field the load lands in.
 */
export function recordUnplannedLoad(day: DaySlot, load: number): DaySlot {
  if (day.workouts.length === 0) {
    return { ...day, unplannedLoad: (day.unplannedLoad ?? 0) + load };
  }
  return { ...day, actualLoad: load };
}

export async function runDailyAdaptation(
  userId: string,
  now = new Date()
): Promise<"adapted" | "skipped"> {
  const week = await getOpenWeekPlan(userId);
  if (!week) return "skipped";
  const today = localYmd(now);
  if (!week.days.some((d) => d.date === today)) return "skipped";

  // Yesterday completion: match a synced activity to whatever yesterday
  // held. A planned/moved/adapted day matches on ITS OWN sport (below) —
  // that constraint makes sense there because the plan named an expected
  // sport for that slot. `yesterdayCompleted` is meaningful only for that
  // case: it feeds adaptDay's missed/completed handling, which needs to
  // know whether a *planned* session did or didn't happen.
  const yesterdayYmd = addDaysYmd(today, -1);
  const ySlot = week.days.find((d) => d.date === yesterdayYmd);
  const ySlotWorkout = ySlot?.workouts[0] ?? null;
  let yesterdayCompleted: boolean | null = null;
  let matched: { id: string; load: number | null } | null = null;

  // A session may only be written off as missed once the ride has had a
  // chance to arrive. onWellnessDataChanged re-runs this on every wellness
  // event — including an hourly Apple Health push at 04:50 — and an
  // activity sync has usually not run yet at that hour. Judging "missed"
  // there wrote off rides the athlete had actually done: three consecutive
  // weeks closed as "fully missed", each cutting the next to 60%.
  const ACTIVITY_PROVIDERS = ["intervals_icu", "strava"] as const;
  const activityConns = await db.query.connections.findMany({
    where: and(
      eq(schema.connections.userId, userId),
      inArray(schema.connections.provider, [...ACTIVITY_PROVIDERS])
    ),
  });
  const dayEnd = new Date(today + "T00:00:00"); // local midnight = end of yesterday
  const activitiesSettled =
    activityConns.length === 0 ||
    activityConns.some((c) => c.lastSyncAt != null && c.lastSyncAt >= dayEnd);

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
    // Sport is compared through the canonical vocabulary, never with a raw
    // equality: the planner says "Bike", every provider says "Ride" (or
    // "VirtualRide", …), so `eq()` here matched nothing for cyclists. Not one
    // planned ride ever completed, so every week closed with actualLoad 0,
    // effectiveWeekLoad read that as "fully missed", and the next week
    // restarted at 60% of skeleton — compounding, week after week. Runners
    // never saw it, because "Run" happened to equal "Run".
    const activity = await db.query.activities.findFirst({
      where: and(
        eq(schema.activities.userId, userId),
        inArray(
          sql`lower(${schema.activities.sport})`,
          providerSportAliases(ySlotWorkout.sport)
        ),
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
    } else if (activitiesSettled) {
      yesterdayCompleted = false;
    }
    // else: leave null — nothing to judge yet, so adaptDay's missed-workout
    // handling does not run and the session stays put.
  } else if (
    ySlot != null &&
    (ySlot.status === "rest" || ySlot.status === "race")
  ) {
    // No planned session yesterday — a rest day never had a sport to match
    // against, and a race day's "session" isn't represented in `workouts`
    // either (materializeWeek clears it there in favour of `raceName`), so
    // the sport-equality constraint above simply doesn't apply: there is no
    // expected sport to compare to. Match ANY activity on the local date
    // instead. Whatever comes back — a bonus ride on the rest day, or the
    // race performance itself — is booked purely through
    // recordUnplannedLoad below, which routes a day with no workouts to
    // unplannedLoad without touching status: a race day keeps
    // "race"/raceName, a rest day keeps "rest". Covering race days here
    // (not just rest) follows the design directly — "an activity landing on
    // a day with no planned session ... is recorded as unplannedLoad"
    // describes both equally; a race day has no `workouts` entry any more
    // than a rest day does, and letting its activity book as unplanned load
    // is strictly additive information (nothing is fabricated or removed).
    // yesterdayCompleted is deliberately left null: there was nothing
    // planned to mark completed or missed, so adaptDay's missed-workout
    // handling must not run for this day.
    const activity = await db.query.activities.findFirst({
      where: and(
        eq(schema.activities.userId, userId),
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
      matched = { id: activity.id, load: activity.load };
    }
  }

  const metric = await db.query.dailyMetrics.findFirst({
    where: and(
      eq(schema.dailyMetrics.userId, userId),
      eq(schema.dailyMetrics.date, today)
    ),
  });
  const band = (metric?.band ?? "calibrating") as Band;

  // adaptDay may scale, step down or move a session in response to
  // readiness and availability. It must never remove one because the
  // week's load ran ahead of target — that is what unplannedLoad is for.
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
    const idx = result.week.days.findIndex((d) => d.date === yesterdayYmd);
    if (idx !== -1) {
      result.week.days[idx] = {
        ...recordUnplannedLoad(result.week.days[idx], matched.load ?? 0),
        activityId: matched.id,
      };
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
    resolved,
    localYmd(new Date())
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
 * Replans the open week from what the availability tables now say, rather
 * than from a submitted form. Used by any caller that has just written a
 * default or an override directly ("No time today", say) and needs the
 * week's sessions to actually follow it: writing the row alone changes
 * nothing the athlete can see, because adaptDay reads availableBlocks off
 * the stored week, not the override table.
 */
export async function applyResolvedAvailability(
  userId: string
): Promise<"applied" | "no_open_week"> {
  const week = await getOpenWeekPlan(userId);
  if (!week) return "no_open_week";

  const resolved = await resolveWeek(
    userId,
    week.days.map((d) => d.date)
  );
  return applyAvailability(
    userId,
    week.days.map((d) => resolved.get(d.date) ?? [])
  );
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
