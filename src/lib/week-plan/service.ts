// src/lib/week-plan/service.ts — DB orchestration for the living week.
// All plan logic lives in the pure engines (materialize.ts / adapt-day.ts);
// this layer only loads state, runs an engine, and persists the result.
import { and, asc, desc, eq, gte, inArray, lt, ne, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getActivePlan } from "@/lib/active-plan";
import { racesForWeek, currentCtl } from "@/lib/race/service";
import { materializeWeek } from "./materialize";
import { adaptDay } from "./adapt-day";
import { bookWeekActuals, deriveDayActuals, weekActuals } from "./actuals";
import { replanWeek } from "./replan";
import { resolveWeek } from "@/lib/availability/resolve";
import { dayMins } from "./types";
import type { AdjustmentRecord, Band, DaySlot } from "./types";
import { findBlockFor } from "./slots";
import { providerSportAliases } from "@/lib/canonical-sport";
import type { AvailabilityBlock } from "@/lib/availability/types";
import { periodize } from "@/lib/training-plan";
import { planRaceTargets, planWeekOf } from "@/lib/plan-targets";
import { requirePlanSport } from "@/lib/plan-sport";
import { sanitizeDayFlags } from "@/lib/day-flags";
import { assembleVolumeInputs, assembleWeeklyTarget } from "./volume-inputs";
import {
  hoursForMaterialize,
  weeklyTargetHours,
  weekAdherencePct,
  weekTargetLoad,
} from "./volume";
import { plannedMins, resolveFillOptions } from "./fill";
import { taperFractionForWeek } from "@/lib/race/taper";
import type { PlanStyle } from "@/lib/plan-style/types";
import type { ReentryStage, SeasonMode } from "@/lib/season-mode/types";
import { resolvePlanningSurfaceState } from "@/lib/planning-surface/effective-state";
import type { Figure } from "@/lib/uncertainty";

export type AdjustmentRow = typeof schema.planAdjustments.$inferSelect;

export interface OpenWeekPlan {
  id: string;
  planId: string;
  weekStart: string;
  skeletonWeek: number;
  days: DaySlot[];
  /** materializeWeek's effectiveLoad for this week — null on pre-fix rows. */
  effectiveTarget: number | null;
  /** The week's planned minutes as materialized — null on pre-fix rows. */
  materializedMins: number | null;
  /** Set once the athlete (or the coach, on their behalf) confirms this week's availability. */
  availabilityConfirmedAt: Date | null;
  /** Set once this week's availability nudge has actually been pushed. */
  availabilityPromptedAt: Date | null;
  /** Set once the Sunday nudge about NEXT week has been pushed from this row. */
  nextWeekPromptedAt: Date | null;
}

function localYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Exported for weekly-review, which must bucket on the same week boundary. */
export function mondayOf(d: Date): string {
  const day = (d.getDay() + 6) % 7; // Mon=0
  const m = new Date(d);
  m.setDate(d.getDate() - day);
  return localYmd(m);
}

export function addDaysYmd(ymd: string, n: number): string {
  const d = new Date(ymd + "T00:00:00");
  d.setDate(d.getDate() + n);
  return localYmd(d);
}

// daysBetweenYmd / planWeekOf moved to @/lib/plan-targets (Task 6): that
// module has zero imports and is a true leaf, so both this file (which
// training-plan.ts's periodize() depends on) and training-plan.ts itself
// (which needs planWeekOf for a two-race preview) can import them without a
// cycle. Re-exported here would just be a second name for the same import,
// so callers now import planWeekOf directly from @/lib/plan-targets.

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
  planStyle: PlanStyle;
  seasonMode: SeasonMode;
  reentryStage: ReentryStage;
}

export function planConstraints(constraints: unknown): PlanConstraints {
  const c = (constraints ?? {}) as {
    daysPerWeek?: number;
    hoursPerWeek?: number;
    sports?: string[];
    planStyle?: unknown;
    seasonMode?: unknown;
    reentryStage?: unknown;
  };
  const state = resolvePlanningSurfaceState(c);
  return {
    daysPerWeek: c.daysPerWeek ?? 5,
    hoursPerWeek: c.hoursPerWeek ?? 8,
    // F13: this used to fall back to ["Run"] when sports was absent or
    // empty — a fourth silent running fallback, quieter than the other
    // three because it lived in the constraints reader rather than the
    // generator. An absent/empty list now flows through untouched, and
    // requirePlanSport(constraints.sports?.[0]) at the call sites below
    // throws a named error instead of building a running week.
    sports: c.sports ?? [],
    planStyle: state.effectiveStyle,
    seasonMode: state.effectiveSeasonMode,
    reentryStage: state.reentryStage,
  };
}

export function nextReentryStage(stage: ReentryStage): ReentryStage {
  if (stage === "week_1") return "week_2";
  if (stage === "week_2") return "none";
  return "none";
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

/** Last 7 illness flags, oldest first; missing rows are false. */
async function recentIllFlags(userId: string): Promise<boolean[]> {
  const rows = await db.query.wellnessDaily.findMany({
    where: eq(schema.wellnessDaily.userId, userId),
    orderBy: desc(schema.wellnessDaily.date),
    limit: 7,
    columns: { dayFlags: true },
  });
  return rows
    .reverse()
    .map((r) => sanitizeDayFlags(r.dayFlags ?? []).includes("ill"));
}

async function saveAdjustments(
  weekPlanId: string,
  adjustments: AdjustmentRecord[]
): Promise<void> {
  for (const a of adjustments) {
    await db.insert(schema.planAdjustments).values({ weekPlanId, ...a });
  }
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
    materializedMins: row.materializedMins,
    availabilityConfirmedAt: row.availabilityConfirmedAt,
    availabilityPromptedAt: row.availabilityPromptedAt,
    nextWeekPromptedAt: row.nextWeekPromptedAt,
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

/**
 * `weekTargetLoad()` for every block in one batched query, for MCP tools
 * that list several weeks at once (`get_training_plan`, `get_plan_drift`)
 * instead of each reading `targetLoadTotal` directly and reporting the
 * un-tapered skeleton value for a week that has already materialized. Any
 * status (open or closed) counts, since the open week's own effective
 * target is exactly the case this exists to surface. Later `weekStart`
 * wins per skeleton week — plan regeneration can leave more than one row
 * per skeleton week, same precedent as race/debrief.ts.
 */
export async function resolveBlockTargets(
  planId: string,
  blocks: { weekNumber: number; targetLoadTotal: number | null }[]
): Promise<Map<number, Figure<number>>> {
  const weekNumbers = blocks.map((b) => b.weekNumber);
  const rows =
    weekNumbers.length > 0
      ? await db.query.weekPlans.findMany({
          where: and(
            eq(schema.weekPlans.planId, planId),
            inArray(schema.weekPlans.skeletonWeek, weekNumbers)
          ),
          orderBy: asc(schema.weekPlans.weekStart),
        })
      : [];
  const effectiveByWeek = new Map<number, number | null>();
  for (const row of rows) {
    effectiveByWeek.set(row.skeletonWeek, row.effectiveTarget);
  }
  const result = new Map<number, Figure<number>>();
  for (const b of blocks) {
    result.set(
      b.weekNumber,
      weekTargetLoad({
        effectiveTarget: effectiveByWeek.get(b.weekNumber) ?? null,
        blockTarget: b.targetLoadTotal,
      })
    );
  }
  return result;
}

export async function rolloverWeekPlan(
  userId: string,
  now = new Date()
): Promise<"rolled" | "skipped"> {
  const plan = await getActivePlan(userId);
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
    // Close from the activities table, not from whatever the day slots
    // happen to hold. runDailyAdaptation books through YESTERDAY and is
    // triggered by onWellnessDataChanged; this is triggered by the weekly
    // review. Nothing orders the two, so the week's final day would close at
    // zero whenever no pass ran between that day and the rollover.
    const weekEnd = addDaysYmd(row.weekStart, 6);
    const actuals = await deriveDayActuals(userId, row.weekStart, weekEnd);
    const days = bookWeekActuals(row.days as DaySlot[], actuals, weekEnd);
    const { actualLoad, actualSessions } = weekActuals(days);
    const block = await db.query.trainingBlocks.findFirst({
      where: and(
        eq(schema.trainingBlocks.planId, row.planId),
        eq(schema.trainingBlocks.weekNumber, row.skeletonWeek)
      ),
    });
    // Feeds `prevWeek.adherencePct`, which gates the low-adherence safety
    // rail in materialize.ts. See weekAdherencePct's doc in volume.ts for why
    // this must read the week's frozen target rather than a rate, and for
    // the effectiveTarget-over-blockTarget fallback reasoning.
    const adherencePct = weekAdherencePct({
      effectiveTarget: row.effectiveTarget,
      blockTarget: block?.targetLoadTotal ?? null,
      actualLoad,
    });
    if (block) {
      await db
        .update(schema.trainingBlocks)
        .set({ actualLoad, actualSessions, adherencePct })
        .where(eq(schema.trainingBlocks.id, block.id));
    }
    await db
      .update(schema.weekPlans)
      .set({ days, status: "closed", updatedAt: now })
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
  const nextStage = nextReentryStage(constraints.reentryStage);
  if (nextStage !== constraints.reentryStage) {
    const current = (plan.constraints as Record<string, unknown> | null) ?? {};
    await db
      .update(schema.trainingPlans)
      .set({ constraints: { ...current, reentryStage: nextStage } })
      .where(eq(schema.trainingPlans.id, plan.id));
  }
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
    raceDemandHours: volumeInputs.demand?.available
      ? volumeInputs.demand.weeklyHours
      : null,
    ceilingHours: volumeInputs.level.ceilingHours,
    floorHours: volumeInputs.level.floorHours,
    availabilityHours,
    fallbackHours: constraints.hoursPerWeek,
  });
  // The hardest single day this athlete's event demands — what a long ride
  // should build toward. Null when there is no race or no FTP, which keeps
  // the pre-existing 240-minute bound. Shared by both `periodize` and
  // `materializeWeek` below so they can't drift onto different values.
  const queenStageHours = volumeInputs.demand?.available
    ? volumeInputs.demand.queenStageHours
    : null;

  // A sport word (canonicalised via requirePlanSport), never plan.raceType —
  // raceType is free text with no closed vocabulary, and inferring a sport
  // from it here would mean this live, recurring rollover throws for any
  // historical or unusual spelling. constraints.sports[0] is what
  // generateTrainingPlan actually decided the plan's sport was.
  const sport = requirePlanSport(constraints.sports?.[0]);

  // Which race is which, read the one way this plan row is allowed to be
  // read for it — never by picking raceDate/raceId off `plan` directly.
  const targets = planRaceTargets(plan);
  const firstRace = targets.first
    ? {
        weekNumber: planWeekOf(plan.startDate, targets.first.date),
        raceType: targets.first.raceType,
      }
    : null;

  // Recomputed fresh, never read as authority — a stored target is exactly
  // how `hoursPerWeek` went stale in the first place.
  const derivedBlocks = periodize({
    weeksTotal: plan.weeksTotal,
    startingCtl: plan.startingCtl ?? 0,
    daysPerWeek: constraints.daysPerWeek,
    hoursPerWeek: target.hours,
    sport,
    queenStageHours,
    firstRace,
  });
  const derived =
    derivedBlocks.find((b) => b.weekNumber === plan.currentWeek) ??
    derivedBlocks[derivedBlocks.length - 1];

  // 3. Materialize.
  const [races, ctlNow, bands, illnessFlags] = await Promise.all([
    racesForWeek(userId, weekStart),
    currentCtl(userId),
    recentBands(userId),
    recentIllFlags(userId),
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
    recentBands: bands,
    recentIllFlags: illnessFlags,
    sport,
    hoursPerWeek: hoursForMaterialize(target),
    races,
    currentCtl: ctlNow,
    queenStageHours,
    planStyle: constraints.planStyle,
    seasonMode: constraints.seasonMode,
    reentryStage: constraints.reentryStage,
    previousARace: targets.first
      ? { date: targets.first.date, raceType: targets.first.raceType }
      : null,
    // Read off the SAME assembleVolumeInputs() call this function already
    // makes above (`volumeInputs`, for target/queenStageHours) rather than
    // a second `bodyPrefs` query here — assembleVolumeInputs already fetches
    // that row for levelOverride/FTP/pace, and derives oneRms from it once.
    oneRms: volumeInputs.oneRms,
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
      materializedMins: plannedMins(r.week.days),
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

  // Did YESTERDAY's planned session happen? This is a different question
  // from "what work happened", which bookWeekActuals below answers for every
  // past day with no sport test and no status gate. Only this one needs the
  // sport match and the settled-sync bound, because only this one feeds
  // adaptDay's missed-workout handling. Tangling the two is what made a
  // completed, missed or cross-sport day book its load nowhere at all.
  const yesterdayYmd = addDaysYmd(today, -1);
  const ySlot = week.days.find((d) => d.date === yesterdayYmd);
  const ySlotWorkout = ySlot?.workouts[0] ?? null;
  let yesterdayCompleted: boolean | null = null;

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
  // Bound the wait: `lastSyncAt` is written only on a SUCCESSFUL sync
  // (intervals-sync.ts), and on auth_expired it sets status "error" — after
  // which ensureJobsForConnections (scheduler.ts) only schedules "active"
  // connections, so nothing ever syncs again and lastSyncAt freezes for
  // good. Left unbounded, that reads as "wait forever": missed-workout
  // judgement silently disables itself the moment a token expires, with no
  // signal to the athlete or anyone else. A non-auth_expired failure,
  // though, leaves status "active" (same file) and can keep failing
  // indefinitely without ever flipping — so status alone doesn't cover
  // every stall. Two independent bounds, either one enough to call a
  // connection done waiting for: it will provably never sync again
  // (status !== "active"), or it has gone quiet long enough that waiting
  // longer stops being "the ride probably hasn't landed yet" and starts
  // being "something is wrong" — a small number of days, not hours, so a
  // normal overnight/weekend sync gap never trips it.
  const ACTIVITY_SYNC_STALE_DAYS = 3;
  const staleCutoff = new Date(now);
  staleCutoff.setDate(staleCutoff.getDate() - ACTIVITY_SYNC_STALE_DAYS);
  const activitiesSettled =
    activityConns.length === 0 ||
    activityConns.some(
      (c) =>
        (c.lastSyncAt != null && c.lastSyncAt >= dayEnd) ||
        c.status !== "active" ||
        (c.lastSyncAt != null && c.lastSyncAt < staleCutoff)
    );

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
        // Strava's Nov 2024 API agreement keeps its data out of AI surfaces,
        // and the week plan is one: the coach reads it through get_week_plan.
        // Every ride also exists twice (once per connector) with an identical
        // start_date and no tie-break, so without this the winner came down
        // to heap order — and the two loads diverge badly (live: 184 vs 83).
        ne(schema.activities.provider, "strava"),
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
    } else if (activitiesSettled) {
      yesterdayCompleted = false;
    }
    // else: leave null — nothing to judge yet, so adaptDay's missed-workout
    // handling does not run and the session stays put.
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

  // Book what actually happened onto every past day of the week, from the
  // activities table. Runs AFTER adaptDay because adaptDay may empty a
  // missed day's workouts, and that is what routes a cross-sport day's load
  // to unplannedLoad rather than reading as the planned session's actual.
  //
  // Today is deliberately not booked: its load is still accumulating, and
  // /train renders today live off deriveDayActuals anyway — the same
  // derivation this books from.
  //
  // That leaves the week's FINAL day permanently unbookable here, and not
  // merely as a matter of ordering: booking it would need a call where today
  // is the day after the week's last, and by then rolloverWeekPlan has closed
  // this week — getOpenWeekPlan returns the new one, and the guard at the top
  // of this function returns "skipped" before reaching this point. Only the
  // close itself can book that day, which is why rolloverWeekPlan has to
  // re-derive rather than sum whatever these fields happen to hold.
  if (yesterdayYmd >= week.weekStart) {
    const actuals = await deriveDayActuals(
      userId,
      week.weekStart,
      yesterdayYmd
    );
    result.week.days = bookWeekActuals(result.week.days, actuals, yesterdayYmd);
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

  const now = new Date();

  // The LIVE target, not the stored `effectiveTarget`. A week built while
  // booked load read zero carries a stale figure forever; fill must not be
  // misled by it. assembleWeeklyTarget is the same producer the dashboard's
  // WeekRow and /train's WeekRationale already read, so fill cannot disagree
  // with the number the athlete is shown.
  //
  // MINUTES. `target.hours` is hours and `effectiveTarget` is a load — a
  // confusion this repo has already shipped once.
  //
  // The actual enable/disable DECISION (no plan → decline; taper/race week
  // → decline) is made by the pure `resolveFillOptions`, not here — this
  // block only resolves the I/O its inputs need. `taperFraction` is computed
  // the same way `materializeWeek` picks its primary race (first of
  // `racesForWeek`'s already-sorted priority-A→C, date-asc order; only an
  // A-priority race taper-shapes a week), so fill's notion of "taper week"
  // and the engine's cannot disagree.
  const plan = await getActivePlan(userId);
  let taperFraction: number | null = null;
  let targetHours = 0;
  let queenStageHours: number | null = null;
  if (plan) {
    const availabilityHours =
      blocksPerDay.reduce(
        (s, blocks) => s + dayMins({ availableBlocks: blocks }),
        0
      ) / 60;
    const [{ target, demand }, races] = await Promise.all([
      assembleWeeklyTarget(userId, now, {
        availabilityHours,
        planHoursPerWeek: planConstraints(plan.constraints).hoursPerWeek,
      }),
      racesForWeek(userId, week.weekStart),
    ]);
    const primary = races[0] ?? null;
    taperFraction =
      primary && primary.priority === "A"
        ? taperFractionForWeek(week.weekStart, primary)
        : null;
    targetHours = target.hours;
    queenStageHours = demand?.available ? demand.queenStageHours : null;
  }
  const fill = resolveFillOptions({
    hasActivePlan: plan != null,
    taperFraction,
    targetHours,
    queenStageHours,
    today: localYmd(now),
  });

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
    localYmd(now),
    fill
  );

  const oldTotal = week.days.reduce((s, d) => s + dayMins(d), 0);
  const newTotal = r.week.days.reduce((s, d) => s + dayMins(d), 0);

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
 *
 * Callers (set-standard-week, the availability-change form) invoke this on
 * every touch, whether or not the resolution actually moved — a plain
 * defaults edit that leaves this week's dates untouched, or a second save
 * of the same values, resolves to exactly what the week already holds. Only
 * replan when the resolved blocks genuinely differ from the stored week's,
 * date by date and block by block — not just by comparing total hours,
 * since two different block shapes can land on the same total and do need
 * a replan. `availability_change/redistributed — 19.2h→19.2h`, logged three
 * times running against no actual change, is what this guards against.
 */
export async function applyResolvedAvailability(
  userId: string
): Promise<"applied" | "no_open_week" | "skipped"> {
  const week = await getOpenWeekPlan(userId);
  if (!week) return "no_open_week";

  const resolved = await resolveWeek(
    userId,
    week.days.map((d) => d.date)
  );

  const unchanged = week.days.every(
    (d) =>
      JSON.stringify(resolved.get(d.date) ?? []) ===
      JSON.stringify(d.availableBlocks)
  );
  if (unchanged) return "skipped";

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
 * tick moves the week's session count and nothing else — when the ride
 * syncs, runDailyAdaptation's booking pass attaches the real load, and the
 * day is already where it belongs.
 *
 * Before v0.44 that last clause was simply untrue: no booking branch covered
 * status "completed", so pressing this button meant the day's load was never
 * recorded at all. The live week of 2026-07-27 lost 469 of 783 that way.
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
