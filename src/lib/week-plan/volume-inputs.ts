/**
 * Gathers everything the volume model needs, in one place, so the pure
 * modules stay pure: event demand, the athlete's rolling peak, and their
 * longest recent session in the race's own sport.
 */
import { and, desc, eq, gte } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { dedupeActivities } from "@/lib/training-load";
import { eventDemand, type EventDemandResult } from "@/lib/race/demand";
import { resolveFtpAnchor } from "@/lib/race/service";
import { canonicalSport } from "@/lib/canonical-sport";
import { disciplinesOf, type PlanSport } from "@/lib/plan-sport";
import {
  athleteLevel,
  LEVEL_CONSTANTS,
  type AthleteLevel,
  type LevelResult,
} from "@/lib/athlete-level";
import {
  ANCHOR_CONSTANTS,
  swimPaceFromHistory,
  thresholdPaceFromHistory,
} from "./anchors";
import { weeklyDisplayTarget, type VolumeResult } from "./volume";
import {
  oneRmsFromBodyPrefs,
  type OneRepMaxes,
} from "@/lib/strength/prescription";

/** Monday of the week containing `d`, at local midnight. */
function weekStartOf(d: Date): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  out.setDate(out.getDate() - ((out.getDay() + 6) % 7));
  return out;
}

/**
 * Oldest-first bucket index for the week starting at `weekStart`, in a
 * `weeks`-slot window ending at (and including) `thisWeek`. Shared by
 * weeklyHoursByWeek and the CTL-bucketing loop in assembleVolumeInputs so
 * the two copies of this arithmetic cannot drift. Out-of-window results
 * (negative, or >= weeks) are the caller's responsibility to skip.
 */
function weekIndex(weekStart: Date, thisWeek: Date, weeks: number): number {
  const weeksAgo = Math.round(
    (thisWeek.getTime() - weekStart.getTime()) / (7 * 24 * 3600 * 1000)
  );
  return weeks - 1 - weeksAgo;
}

// wellnessDaily.date is a Postgres `date` column, which drizzle types as a
// plain YYYY-MM-DD string (see races.date / dailyMetrics.date elsewhere in
// this codebase) — comparing it against a JS Date fails npx tsc --noEmit
// (TS2769). Same local-calendar convention as the many other `localYmd`
// helpers in src/lib/*.ts.
function localYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export interface HistoryActivity {
  provider: string;
  sport: string;
  startDate: Date;
  durationS: number | null;
}

/**
 * Training hours per week for the last `weeks` weeks, oldest first, one entry
 * per week including zeros. De-duplicated across providers first: the same
 * ride reaches us once per connected service, and this feeds the level model.
 */
export function weeklyHoursByWeek(
  activities: HistoryActivity[],
  now: Date,
  weeks: number
): number[] {
  const thisWeek = weekStartOf(now);
  const buckets = new Array<number>(weeks).fill(0);

  const unique = dedupeActivities(
    activities.map((a) => ({
      provider: a.provider,
      startDate: a.startDate,
      durationS: a.durationS,
      load: null,
      avgHr: null,
      avgPower: null,
    }))
  );

  for (const a of unique) {
    const start = weekStartOf(a.startDate);
    const idx = weekIndex(start, thisWeek, weeks);
    if (idx < 0 || idx >= weeks) continue;
    buckets[idx] += (a.durationS ?? 0) / 3600;
  }
  return buckets;
}

/**
 * Longest single de-duplicated session in the window that counts as one of
 * `disciplines`, in hours.
 *
 * The sport filter is the whole point. Before v0.46 this took the longest
 * activity of ANY kind — it was named for a ride and computed the longest
 * anything — so a triathlete's marathon readiness was answered by their
 * longest bike ride, and a cyclist who hikes could have a long walk outrank
 * every ride they own.
 */
export function longestSessionHoursOf(
  activities: HistoryActivity[],
  disciplines: readonly string[]
): number | null {
  const wanted = new Set(disciplines);
  const unique = dedupeActivities(
    activities
      .filter((a) => wanted.has(canonicalSport(a.sport)))
      .map((a) => ({
        provider: a.provider,
        startDate: a.startDate,
        durationS: a.durationS,
        load: null,
        avgHr: null,
        avgPower: null,
      }))
  );
  let longest = 0;
  for (const a of unique)
    longest = Math.max(longest, (a.durationS ?? 0) / 3600);
  return longest > 0 ? longest : null;
}

export interface VolumeInputsResult {
  // null here means "no target race at all", which is a different thing
  // from "a race we could not price" — that is `{ available: false }`.
  demand: EventDemandResult | null;
  level: LevelResult;
  longestSessionHours: number | null;
  targetRace: {
    id: string;
    name: string;
    date: string;
    sport: PlanSport;
  } | null;
  /**
   * The athlete's per-lift maxima, or null when they have opted out (no
   * bodyPrefs row, or a row with all four still null). Derived once here
   * from the SAME `prefs` row this function already fetches for
   * `levelOverride`/`thresholdPaceSecPerKm`/FTP anchoring, rather than a
   * second `bodyPrefs` query at each `materializeWeek` caller — both
   * `rolloverWeekPlan` (service.ts) and `projectWeek` (project.ts) call
   * `assembleVolumeInputs` before `materializeWeek` already, so this is
   * the one place the row needs reading.
   */
  oneRms: OneRepMaxes | null;
}

export async function assembleVolumeInputs(
  userId: string,
  now: Date
): Promise<VolumeInputsResult> {
  const weeks = LEVEL_CONSTANTS.PEAK_WINDOW_WEEKS;
  const floor = new Date(now);
  floor.setDate(floor.getDate() - weeks * 7);

  // The pace anchor needs a wider window than the rolling peak
  // (ANCHOR_CONSTANTS.WINDOW_DAYS = 180 vs. the 12-week/84-day floor above),
  // so it gets its own query rather than widening `rows` — widening `rows`
  // would move athleteLevel's rolling peak, and this release must not move
  // the reporting cyclist's numbers.
  const anchorFloor = new Date(now);
  anchorFloor.setDate(anchorFloor.getDate() - ANCHOR_CONSTANTS.WINDOW_DAYS);

  const [rows, wellness, dailyMetrics, prefs, races, anchorRows] =
    await Promise.all([
      db.query.activities.findMany({
        where: and(
          eq(schema.activities.userId, userId),
          gte(schema.activities.startDate, floor)
        ),
      }),
      db.query.wellnessDaily.findMany({
        where: and(
          eq(schema.wellnessDaily.userId, userId),
          gte(schema.wellnessDaily.date, localYmd(floor))
        ),
        orderBy: desc(schema.wellnessDaily.date),
      }),
      // The resolved authority for ctl/atl — the provider's value wins when
      // present, and Recover's native engine fills the gap when it isn't
      // (metrics.ts:43-45). wellness_daily.ctl is provider-only and stays
      // empty for an athlete with no intervals.icu connection, even though
      // Recover has computed their CTL all along.
      db.query.dailyMetrics.findMany({
        where: and(
          eq(schema.dailyMetrics.userId, userId),
          gte(schema.dailyMetrics.date, localYmd(floor))
        ),
        orderBy: desc(schema.dailyMetrics.date),
      }),
      db.query.bodyPrefs.findFirst({
        where: eq(schema.bodyPrefs.userId, userId),
      }),
      db.query.races.findMany({
        where: and(
          eq(schema.races.userId, userId),
          eq(schema.races.status, "upcoming"),
          // A past-due race with no synced result activity stays "upcoming"
          // forever (see runRaceDebriefs in race/debrief.ts — only
          // debriefedAt is set on the no-data path, never status). Without
          // this guard, sorted-by-date-ascending would let that stale race
          // outrank the real next race. Same convention as nextUpcomingRace
          // in race/service.ts.
          gte(schema.races.date, localYmd(now))
        ),
      }),
      db.query.activities.findMany({
        where: and(
          eq(schema.activities.userId, userId),
          gte(schema.activities.startDate, anchorFloor)
        ),
        columns: { sport: true, distanceM: true, durationS: true },
      }),
    ]);

  const history: HistoryActivity[] = rows.map((r) => ({
    provider: r.provider,
    sport: r.sport,
    startDate: r.startDateLocal ?? r.startDate,
    durationS: r.durationS,
  }));

  // CTL per week: the highest value seen in each week is what the rolling
  // peak wants, and daily_metrics rows are daily. Read the resolved
  // daily_metrics.ctl, not wellness_daily.ctl — the latter is provider-only
  // and stays empty for an athlete with no intervals.icu connection even
  // though Recover's native engine has computed a real CTL for them all
  // along (metrics.ts:43-45).
  const ctlBuckets = new Array<number>(weeks).fill(0);
  const thisWeek = weekStartOf(now);
  for (const w of dailyMetrics) {
    if (w.ctl == null) continue;
    // w.date is a YYYY-MM-DD string; bare `new Date()` parses it as UTC
    // midnight, which lands in the wrong local week behind UTC. Same fix as
    // race/debrief.ts, race/service.ts, race/taper.ts, race/forecast.ts,
    // format.ts, sleep-insights.ts, morning-insight.ts, training-plan.ts.
    const start = weekStartOf(new Date(w.date + "T00:00:00"));
    const idx = weekIndex(start, thisWeek, weeks);
    if (idx < 0 || idx >= weeks) continue;
    ctlBuckets[idx] = Math.max(ctlBuckets[idx], w.ctl);
  }

  const level = athleteLevel({
    weeklyHoursByWeek: weeklyHoursByWeek(history, now, weeks),
    ctlByWeek: ctlBuckets,
    override: (prefs?.levelOverride as AthleteLevel | null) ?? null,
  });

  // Highest priority first, then nearest date — the same ordering the taper
  // uses, so there is one rule for "the race we are training for", not two.
  const order = { A: 0, B: 1, C: 2 } as const;
  const target =
    [...races].sort(
      (a, b) =>
        order[a.priority] - order[b.priority] || a.date.localeCompare(b.date)
    )[0] ?? null;

  let demand: EventDemandResult | null = null;
  if (target) {
    const stages = await db.query.raceStages.findMany({
      where: eq(schema.raceStages.raceId, target.id),
    });
    const latestWeight = wellness.find((w) => w.weightKg != null)?.weightKg;
    const latestEftp = wellness.find((w) => w.eftp != null)?.eftp;
    const runPaceSet = prefs?.thresholdPaceSecPerKm ?? null;
    const runPaceDerived =
      runPaceSet == null ? thresholdPaceFromHistory(anchorRows) : null;
    const swimDerived = swimPaceFromHistory(anchorRows);
    const ftpAnchor = resolveFtpAnchor(prefs ?? null, latestEftp ?? null);

    demand = eventDemand({
      sport: target.sport,
      raceType: target.raceType,
      eventDays: target.eventDays ?? 1,
      distanceKm: target.distanceKm,
      elevationM: target.elevationM,
      stages: stages.map((s) => ({
        dayNumber: s.dayNumber,
        distanceKm: s.distanceKm,
        elevationM: s.elevationM,
      })),
      overrideWeeklyHours: target.demandHoursOverride,
      expectedFinishHours: target.expectedFinishHours,
      ftp: ftpAnchor,
      // Rider weight plus an allowance for bike and kit.
      massKg: latestWeight != null ? latestWeight + 8 : null,
      runPace:
        runPaceSet != null
          ? { secPerKm: runPaceSet, athleteSet: true }
          : runPaceDerived != null
            ? { secPerKm: runPaceDerived, athleteSet: false }
            : null,
      swimPace:
        swimDerived != null
          ? { secPer100m: swimDerived, athleteSet: false }
          : null,
    });
  }

  return {
    demand,
    level,
    longestSessionHours: target
      ? longestSessionHoursOf(history, disciplinesOf(target.sport))
      : null,
    targetRace: target
      ? {
          id: target.id,
          name: target.name,
          date: String(target.date),
          sport: target.sport,
        }
      : null,
    oneRms: oneRmsFromBodyPrefs(prefs),
  };
}

export interface WeeklyTargetResult extends VolumeInputsResult {
  target: VolumeResult;
}

/**
 * The single place `weeklyDisplayTarget` is called for anything that
 * DISPLAYS this week's hours target. Both the dashboard (`/`, WeekRow) and
 * `/train` (WeekRationale) render "planned vs target" from this function's
 * `target.hours`, so the two surfaces are structurally incapable of
 * disagreeing.
 *
 * Before this existed, the dashboard showed the plan's typed
 * `constraints.hoursPerWeek` while /train showed the derived, race/ceiling-
 * aware figure — the exact staleness this branch exists to retire
 * (final-review Finding I5).
 *
 * Callers supply what they already have in scope — the open week's
 * resolved availability and the plan's own `hoursPerWeek` — rather than
 * this function re-querying either.
 */
export async function assembleWeeklyTarget(
  userId: string,
  now: Date,
  input: { availabilityHours: number; planHoursPerWeek: number }
): Promise<WeeklyTargetResult> {
  const volumeInputs = await assembleVolumeInputs(userId, now);
  const target = weeklyDisplayTarget({
    raceDemandHours: volumeInputs.demand?.available
      ? volumeInputs.demand.weeklyHours
      : null,
    ceilingHours: volumeInputs.level.ceilingHours,
    floorHours: volumeInputs.level.floorHours,
    availabilityHours: input.availabilityHours,
    planHoursPerWeek: input.planHoursPerWeek,
  });
  return { ...volumeInputs, target };
}
