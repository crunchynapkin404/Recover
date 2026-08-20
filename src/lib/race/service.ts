// src/lib/race/service.ts — race CRUD. Pure race math lives in taper.ts /
// forecast.ts; this layer only touches the DB.
import { and, asc, desc, eq, gte, inArray, lte, ne } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { Projected } from "@/lib/db/projected";
import type { PlanSport } from "@/lib/plan-sport";
import type { RaceContext } from "./taper";
import type { ForecastInputs } from "./forecast";
import { taperFractionForWeek } from "./taper";
import type { DaySlot } from "@/lib/week-plan/types";
import type { OpenWeekPlan } from "@/lib/week-plan/service";
import { weekLoadPerMin, weekTargetLoad } from "@/lib/week-plan/volume";
import { openWeekPlannedLoads } from "@/lib/week-plan/planned-loads";
import {
  ANCHOR_CONSTANTS,
  thresholdPaceFromHistory,
} from "@/lib/week-plan/anchors";

export type RaceRow = typeof schema.races.$inferSelect;
export type RacePriority = "A" | "B" | "C";
export type RaceStatus = "upcoming" | "completed" | "skipped";

/**
 * A stage as consumers see it. Guarded by `Projected<>` for the same reason
 * `races` is: `race_stages` is a small table today, and a column added to it
 * would otherwise stop at this boundary in silence.
 */
export type RaceStageDetail = Projected<
  typeof schema.raceStages,
  // Surrogate key. Nothing addresses a stage directly — stages are written
  // wholesale per race by `writeRaceDemand`.
  | "id"
  // The parent race. Consumers already have it: this map is keyed by it.
  | "raceId"
  // Row lifecycle, not event detail.
  | "createdAt"
>;

/**
 * Per-day stage detail for many races in ONE query, grouped by race id and
 * sorted day-ascending. Both `/train`'s race list and the coach's `get_races`
 * need this for every race on screen, and N+1 across a season of races is
 * the obvious wrong answer.
 *
 * A race with no stage rows is simply absent from the map. Callers use
 * `?? []`, and an empty list means "no per-day detail on file" — NOT "a
 * one-day event" and NOT "flat". A four-day event with only totals entered
 * lands here too.
 */
export async function stagesByRaceIds(
  raceIds: string[]
): Promise<Map<string, RaceStageDetail[]>> {
  const byRace = new Map<string, RaceStageDetail[]>();
  if (raceIds.length === 0) return byRace;
  const rows = await db.query.raceStages.findMany({
    where: inArray(schema.raceStages.raceId, raceIds),
  });
  for (const s of rows) {
    const arr = byRace.get(s.raceId) ?? [];
    arr.push({
      dayNumber: s.dayNumber,
      name: s.name,
      distanceKm: s.distanceKm,
      elevationM: s.elevationM,
    });
    byRace.set(s.raceId, arr);
  }
  for (const arr of byRace.values()) {
    arr.sort((a, b) => a.dayNumber - b.dayNumber);
  }
  return byRace;
}

export interface RaceInput {
  name: string;
  raceType: string;
  date: string; // YYYY-MM-DD
  priority: RacePriority;
  /**
   * Required. The race is the single authority for a plan's sport, so a
   * race that does not name one cannot exist — see plan-sport.ts.
   */
  sport: PlanSport;
  goalNote?: string | null;
  /** Defaults to "upcoming" on create; left untouched on conflict when omitted. */
  status?: RaceStatus;
}

function localYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export async function createRace(
  userId: string,
  input: RaceInput,
  now = new Date()
): Promise<{ race: RaceRow } | { error: "past_date" }> {
  if (input.date < localYmd(now)) return { error: "past_date" };
  const [race] = await db
    .insert(schema.races)
    .values({
      userId,
      name: input.name,
      raceType: input.raceType,
      sport: input.sport,
      date: input.date,
      priority: input.priority,
      goalNote: input.goalNote ?? null,
      // Omitted → the column default ("upcoming") applies.
      ...(input.status ? { status: input.status } : {}),
    })
    .onConflictDoUpdate({
      target: [schema.races.userId, schema.races.date, schema.races.name],
      set: {
        raceType: input.raceType,
        sport: input.sport,
        priority: input.priority,
        goalNote: input.goalNote ?? null,
        updatedAt: now,
        // Omitted → leave the existing row's status untouched.
        ...(input.status ? { status: input.status } : {}),
      },
    })
    .returning();
  return { race };
}

export async function updateRace(
  userId: string,
  id: string,
  patch: Partial<RaceInput> & { status?: RaceStatus },
  now = new Date()
): Promise<RaceRow | { error: "not_found" | "past_date" }> {
  const existing = await db.query.races.findFirst({
    where: and(eq(schema.races.id, id), eq(schema.races.userId, userId)),
  });
  if (!existing) return { error: "not_found" };
  if (patch.date && patch.date !== existing.date && patch.date < localYmd(now))
    return { error: "past_date" };
  const [row] = await db
    .update(schema.races)
    .set({ ...patch, updatedAt: now })
    .where(and(eq(schema.races.id, id), eq(schema.races.userId, userId)))
    .returning();
  return row;
}

export async function deleteRace(userId: string, id: string): Promise<boolean> {
  const rows = await db
    .delete(schema.races)
    .where(and(eq(schema.races.id, id), eq(schema.races.userId, userId)))
    .returning();
  return rows.length > 0;
}

export async function listRaces(
  userId: string,
  opts?: { status?: RaceStatus; priority?: RacePriority }
): Promise<RaceRow[]> {
  const conds = [eq(schema.races.userId, userId)];
  if (opts?.status) conds.push(eq(schema.races.status, opts.status));
  if (opts?.priority) conds.push(eq(schema.races.priority, opts.priority));
  return db.query.races.findMany({
    where: and(...conds),
    orderBy: asc(schema.races.date),
  });
}

export async function nextUpcomingRace(
  userId: string,
  now = new Date()
): Promise<RaceRow | null> {
  const row = await db.query.races.findFirst({
    where: and(
      eq(schema.races.userId, userId),
      eq(schema.races.status, "upcoming"),
      gte(schema.races.date, localYmd(now))
    ),
    // Same-date ties resolve to the race created first — the
    // earliest-committed intent (see Task 11: implicit A-race creation
    // means two A races can legitimately share a date).
    orderBy: [asc(schema.races.date), asc(schema.races.createdAt)],
  });
  return row ?? null;
}

const PRIORITY_ORDER: Record<string, number> = { A: 0, B: 1, C: 2 };

function addDaysYmd(ymd: string, n: number): string {
  const d = new Date(ymd + "T00:00:00");
  d.setDate(d.getDate() + n);
  return localYmd(d);
}

/**
 * Upcoming races relevant to the week starting `weekStart`: anything in
 * the week itself (race slots) or within the 27-day lookahead (taper
 * reshaping). Sorted priority A→C then date then createdAt (earliest wins
 * same-date ties, see Task 11) — materializeWeek treats the first entry as
 * primary.
 */
export async function racesForWeek(
  userId: string,
  weekStart: string
): Promise<RaceContext[]> {
  const rows = await db.query.races.findMany({
    where: and(
      eq(schema.races.userId, userId),
      eq(schema.races.status, "upcoming"),
      gte(schema.races.date, weekStart),
      lte(schema.races.date, addDaysYmd(weekStart, 27))
    ),
    orderBy: [asc(schema.races.date), asc(schema.races.createdAt)],
  });
  return rows
    .sort(
      (a, b) =>
        PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] ||
        a.date.localeCompare(b.date) ||
        a.createdAt.getTime() - b.createdAt.getTime()
    )
    .map((r) => ({
      date: r.date,
      priority: r.priority as RaceContext["priority"],
      raceType: r.raceType,
      name: r.name,
    }));
}

/** Latest stored CTL (provider or computed) — taper base fallback. */
export async function currentCtl(userId: string): Promise<number | null> {
  const row = await db.query.dailyMetrics.findFirst({
    where: eq(schema.dailyMetrics.userId, userId),
    orderBy: desc(schema.dailyMetrics.date),
  });
  return row?.ctl ?? null;
}

export interface AssembledForecast {
  inputs: ForecastInputs;
  /** Null when no race anchors the projection (end-of-week anchor). */
  race: RaceRow | null;
}

/**
 * Gather everything forecastForm needs: today's stored CTL/ATL, the open
 * week's remaining planned loads, and the remaining skeleton weeks
 * (taper-reshaped for an A race). The open week's days are projected from a
 * fixed load-per-minute rate set when the week was materialized, so a day's
 * figure depends only on its own minutes, never on what the rest of the
 * week holds.
 *
 * `preloadedWeek` lets a caller that already fetched the open week plan in
 * the same request (e.g. the dashboard) pass it through instead of paying
 * for a second identical `getOpenWeekPlan` round trip — perf pass, v0.20.
 * Omit it (the default, `undefined`) to fetch fresh, exactly as before;
 * explicit `null` means "there is no open week," matching what
 * `getOpenWeekPlan` itself would have returned.
 */
export async function assembleForecastInputs(
  userId: string,
  race: RaceRow | null,
  now = new Date(),
  preloadedWeek?: OpenWeekPlan | null
): Promise<AssembledForecast | null> {
  const week =
    preloadedWeek !== undefined
      ? preloadedWeek
      : await (await import("@/lib/week-plan/service")).getOpenWeekPlan(userId);
  if (!week) return null;
  // Excludes only `draft` (v0.43): looked up by primary key from an
  // existing week_plans row, so an `archived` plan legitimately backs an
  // older open week and must still resolve; only a `draft` was never
  // supposed to be projectable.
  const plan = await db.query.trainingPlans.findFirst({
    where: and(
      eq(schema.trainingPlans.id, week.planId),
      ne(schema.trainingPlans.status, "draft")
    ),
  });
  if (!plan) return null;

  const today = localYmd(now);
  const metric = await db.query.dailyMetrics.findFirst({
    where: eq(schema.dailyMetrics.userId, userId),
    orderBy: desc(schema.dailyMetrics.date),
  });
  const start =
    metric?.ctl != null && metric.atl != null
      ? { ctl: metric.ctl, atl: metric.atl }
      : null;

  const plannedLoads: { date: string; load: number }[] = [];

  // Open week: openBlock now only backs fallbackTarget below.
  const openBlock = await db.query.trainingBlocks.findFirst({
    where: and(
      eq(schema.trainingBlocks.planId, week.planId),
      eq(schema.trainingBlocks.weekNumber, week.skeletonWeek)
    ),
  });
  const perMin = weekLoadPerMin({
    effectiveTarget: week.effectiveTarget,
    materializedMins: week.materializedMins,
  });
  // The open week's target load, via the one shared read path: its
  // persisted effective target (post-taper, post-hours-budget) wins over
  // the block's un-tapered skeleton value — in race week the block still
  // holds the pre-taper number, which would otherwise overstate the load
  // distributed across the tiny opener sessions and understate race-day
  // freshness. Falls back to the block target on rows written before this
  // column existed.
  const weekTarget = weekTargetLoad({
    effectiveTarget: week.effectiveTarget,
    blockTarget: openBlock?.targetLoadTotal ?? null,
  });
  plannedLoads.push(
    ...openWeekPlannedLoads({
      days: week.days,
      perMin,
      fallbackTarget: weekTarget.available ? weekTarget.value : 0,
      today,
    })
  );

  // Future skeleton weeks.
  const blocks = await db.query.trainingBlocks.findMany({
    where: eq(schema.trainingBlocks.planId, week.planId),
  });
  const future = blocks
    .filter((b) => b.weekNumber > week.skeletonWeek)
    .sort((a, b) => a.weekNumber - b.weekNumber);

  const lastClosed = await db.query.weekPlans.findFirst({
    where: and(
      eq(schema.weekPlans.userId, userId),
      eq(schema.weekPlans.status, "closed")
    ),
    orderBy: desc(schema.weekPlans.weekStart),
  });
  const lastActual = lastClosed
    ? (lastClosed.days as DaySlot[]).reduce(
        (s, d) => s + (d.actualLoad ?? 0),
        0
      )
    : 0;
  const ctlNow = metric?.ctl ?? null;

  const raceCtx =
    race && race.priority === "A"
      ? {
          date: race.date,
          priority: "A" as const,
          raceType: race.raceType,
          name: race.name,
        }
      : null;

  let horizonEnd = week.days[6].date;
  for (const [k, block] of future.entries()) {
    const weekStart = addDaysYmd(week.weekStart, 7 * (k + 1));
    horizonEnd = addDaysYmd(weekStart, 6);
    const fraction = raceCtx ? taperFractionForWeek(weekStart, raceCtx) : null;
    const base =
      lastActual > 0
        ? lastActual
        : ctlNow != null
          ? ctlNow * 7
          : (block.targetLoadTotal ?? 0);
    const target =
      fraction != null
        ? Math.round(base * fraction)
        : (block.targetLoadTotal ?? 0);
    const workouts = (block.workouts ?? []) as {
      day: number;
      durationMins: number;
    }[];
    const mins = workouts.reduce((s, w) => s + w.durationMins, 0);
    for (const w of workouts) {
      if (mins === 0) break;
      plannedLoads.push({
        date: addDaysYmd(weekStart, w.day),
        load: Math.round(target * (w.durationMins / mins) * 10) / 10,
      });
    }
  }

  // Trailing adherence: up to 4 most recent completed blocks.
  const adherencePcts = blocks
    .filter((b) => b.weekNumber < week.skeletonWeek && b.adherencePct != null)
    .sort((a, b) => b.weekNumber - a.weekNumber)
    .slice(0, 4)
    .map((b) => b.adherencePct!);
  const adherenceFraction =
    adherencePcts.length > 0
      ? adherencePcts.reduce((s, p) => s + p, 0) / adherencePcts.length / 100
      : null;

  return {
    inputs: {
      today,
      targetDate: race?.date ?? week.days[6].date,
      start,
      plannedLoads: plannedLoads.filter((p) => p.date > today),
      adherenceFraction,
      horizonEnd,
    },
    race,
  };
}

/**
 * The three anchors pacing needs, and nothing else.
 *
 * volume-inputs.ts assembles the same values for the demand model, inline
 * inside a much larger read that also pulls stages, overrides and history
 * derivations. This is deliberately NOT that: pacing needs three numbers, and
 * a focused reader is cheaper to understand than a shared one carrying six
 * callers' worth of options.
 *
 * Athlete-set values win over synced ones, matching demand.ts's `athleteSet`
 * precedence.
 */
export async function pacingAnchors(userId: string): Promise<{
  ftpWatts: number | null;
  massKg: number | null;
  thresholdPaceSecPerKm: number | null;
  /** False when an anchor was derived rather than set by the athlete. */
  ftpAthleteSet: boolean;
  runPaceAthleteSet: boolean;
}> {
  const prefs = await db.query.bodyPrefs.findFirst({
    where: eq(schema.bodyPrefs.userId, userId),
  });
  // NOTE: the column is `date`, not `day` — a Postgres `date` that drizzle
  // types as a string. volume-inputs.ts:46 carries the warning.
  const latest = await db.query.wellnessDaily.findMany({
    where: eq(schema.wellnessDaily.userId, userId),
    orderBy: [desc(schema.wellnessDaily.date)],
    limit: 60,
  });

  const eftp = latest.find((w) => w.eftp != null)?.eftp ?? null;
  const weightKg = latest.find((w) => w.weightKg != null)?.weightKg ?? null;

  // "null = derive from history (Low confidence), then refuse" — the run
  // anchor's own contract, in schema.ts. Refusing without deriving first
  // contradicts the feasibility card two lines above it on the same page,
  // which already says "estimated from your recent runs".
  const runPaceSet = prefs?.thresholdPaceSecPerKm ?? null;
  let runPaceDerived: number | null = null;
  if (runPaceSet == null) {
    const floor = new Date();
    floor.setDate(floor.getDate() - ANCHOR_CONSTANTS.WINDOW_DAYS);
    const anchorRows = await db.query.activities.findMany({
      where: and(
        eq(schema.activities.userId, userId),
        gte(schema.activities.startDate, floor)
      ),
      columns: { sport: true, distanceM: true, durationS: true },
    });
    runPaceDerived = thresholdPaceFromHistory(anchorRows);
  }

  return {
    ftpAthleteSet: prefs?.ftpWatts != null,
    runPaceAthleteSet: runPaceSet != null,
    ftpWatts: prefs?.ftpWatts ?? (eftp != null ? Math.round(eftp) : null),
    // Rider weight PLUS the same 8 kg bike-and-kit allowance the demand model
    // applies (volume-inputs.ts). Without it a pacing target and a demand
    // estimate would silently disagree about how heavy the rider is, and
    // riding-time.ts charges mass against every metre of climbing.
    massKg: weightKg != null ? weightKg + 8 : null,
    thresholdPaceSecPerKm: runPaceSet ?? runPaceDerived,
  };
}
