/**
 * Native training-load engine (v0.10 Honest Load) — pure functions only,
 * no db, no I/O, same shape as readiness.ts.
 *
 * Everything is in TSS-like units (100 ≈ one hour at threshold), matching
 * intervals.icu's `load`, so provider and native values can share one
 * CTL/ATL series. Per-activity ladder, first match wins:
 *   provider load → power TSS → HR TSS → duration estimate → none.
 * The fallbacks deliberately err LOW: fabricating intensity upward is the
 * defect class v0.10 removes.
 */

import { canonicalSport } from "@/lib/canonical-sport";

/**
 * The exponentially-weighted moving-average time constants that define
 * "CTL" and "ATL" as those terms are used throughout this codebase and the
 * training-load field generally (TrainingPeaks, WKO, intervals.icu all use
 * these same defaults). Trace to Dr. Andy Coggan's adaptation of Banister's
 * original impulse-response ("TRIMP") model. Changing either value would
 * mean computing a different metric, not a differently-tuned CTL/ATL.
 * Source: Coggan/Banister exponentially-weighted training-load model,
 * industry-standard time constants.
 * Confidence: Medium (widely-adopted convention; no head-to-head study
 * validates 42/7 as optimal over other time constants).
 */
export const CTL_DAYS = 42;
export const ATL_DAYS = 7;
/**
 * Fewer distinct activity days than this in the trailing CTL window →
 * calibrating.
 * Source: Invented — a design threshold for "enough recent data to trust
 * the number," not evidence-based.
 * Confidence: Low.
 */
export const MIN_LOAD_DAYS = 7;
/**
 * LTHR assumed at this fraction of heart-rate reserve for the HR rung.
 * The origin design spec (docs/specs/2026-07-18-v0.10-honest-load-design.md)
 * states "LTHR ≈ 85% of HRR" as a design assumption, without citing an
 * external source — a recognized coaching convention, not a validated
 * study.
 * Source: Coaching convention (uncited).
 * Confidence: Low.
 */
export const LTHR_HRR_FRACTION = 0.85;
/**
 * Intensity-factor cap — bad HR data must not mint a 200-TSS easy jog.
 * Source: Invented — a data-quality sanity cap, not a physiological claim.
 * Confidence: Low.
 */
export const MAX_HR_IF = 1.15;
/**
 * TSS per hour for the duration rung: an unlabeled hour counts as easy
 * zone-2. A deliberately conservative default (implies IF ≈ 0.63) — the
 * fallback rungs in this file err low on purpose (see the file's opening
 * doc comment); fabricating intensity upward is the defect class this
 * engine exists to remove.
 * Source: Invented — deliberately conservative default, not evidence-based.
 * Confidence: Low.
 */
export const DURATION_TSS_PER_HOUR = 40;
/**
 * Different-provider activities starting within this window may be the
 * same workout.
 * Source: Invented — a cross-provider deduplication heuristic.
 * Confidence: Low.
 */
export const DEDUP_START_WINDOW_MS = 30 * 60 * 1000;
/**
 * ...when their durations also agree within this fraction.
 * Source: Invented — a cross-provider deduplication heuristic.
 * Confidence: Low.
 */
export const DEDUP_DURATION_TOLERANCE = 0.1;

export type LoadSource = "provider" | "power" | "hr" | "duration";

export interface LoadActivity {
  provider: string;
  startDate: Date;
  // Optional: callers that bucket by the athlete's local calendar day (e.g.
  // metrics.ts) read this when present, falling back to startDate. Not used
  // by this file's own load-calculation functions.
  startDateLocal?: Date | null;
  durationS: number | null;
  load: number | null;
  avgHr: number | null;
  avgPower: number | null;
  /**
   * The provider's discipline string. Optional so existing callers that
   * never set it keep their exact prior behavior — only a recognized
   * STRENGTH sport changes any outcome.
   */
  sport?: string | null;
}

export interface AthleteThresholds {
  /** From body_prefs; null = not set. */
  ftpWatts: number | null;
  maxHr: number | null;
  /** Trailing wellness mean, resolved by the caller; null = unknown. */
  restingHr: number | null;
}

export interface ActivityLoad {
  load: number;
  source: LoadSource;
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

/** TSS-like load for one activity, or null when nothing honest can be said. */
export function activityLoad(
  activity: LoadActivity,
  athlete: AthleteThresholds
): ActivityLoad | null {
  // Strength work has no honest TSS. Every rung below this line measures
  // endurance stimulus: the power rung divides by FTP, the HR rung by
  // heart-rate reserve, and the duration rung assumes an easy zone-2 hour.
  // A lift satisfies none of those, so booking it as any of them inflates
  // CTL/ATL with work that is real but not endurance. Refusing is the
  // honest outcome; the session is still tracked and displayed, at a flat
  // figure of its own (STRENGTH_SESSION_LOAD) that never enters this series.
  if (canonicalSport(activity.sport) === "Strength") return null;

  if (activity.load != null && activity.load > 0) {
    return { load: round1(activity.load), source: "provider" };
  }
  if (activity.durationS == null || activity.durationS <= 0) return null;
  const hours = activity.durationS / 3600;

  if (
    activity.avgPower != null &&
    activity.avgPower > 0 &&
    athlete.ftpWatts != null &&
    athlete.ftpWatts > 0
  ) {
    // Average power proxies normalized power — an under-estimate for spiky
    // rides, which is the honest direction of error.
    const intensity = activity.avgPower / athlete.ftpWatts;
    return { load: round1(hours * intensity ** 2 * 100), source: "power" };
  }

  if (
    activity.avgHr != null &&
    athlete.maxHr != null &&
    athlete.restingHr != null &&
    athlete.maxHr > athlete.restingHr &&
    activity.avgHr > 0
  ) {
    const hrr = Math.min(
      1,
      Math.max(
        0,
        (activity.avgHr - athlete.restingHr) /
          (athlete.maxHr - athlete.restingHr)
      )
    );
    const intensity = Math.min(hrr / LTHR_HRR_FRACTION, MAX_HR_IF);
    return { load: round1(hours * intensity ** 2 * 100), source: "hr" };
  }

  return { load: round1(hours * DURATION_TSS_PER_HOUR), source: "duration" };
}

/** Local calendar date of an activity start. */
function ymdOf(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Dedup preference when two providers carry the same workout: a row with a
// provider-computed load always beats one without; then the more canonical
// provider wins.
const PROVIDER_RANK: Record<string, number> = {
  intervals_icu: 0,
  manual: 1,
  strava: 2,
};

function dedupRank(a: LoadActivity): number {
  return (
    (a.load != null && a.load > 0 ? 0 : 10) + (PROVIDER_RANK[a.provider] ?? 3)
  );
}

/**
 * Drop cross-provider duplicates: activities from DIFFERENT providers
 * starting within DEDUP_START_WINDOW_MS whose durations agree within
 * DEDUP_DURATION_TOLERANCE are one workout synced twice.
 */
export function dedupeActivities(activities: LoadActivity[]): LoadActivity[] {
  const sorted = [...activities].sort(
    (a, b) => a.startDate.getTime() - b.startDate.getTime()
  );
  const kept: LoadActivity[] = [];
  for (const next of sorted) {
    const dupAt = kept.findIndex((prev) => {
      if (prev.provider === next.provider) return false;
      if (
        Math.abs(prev.startDate.getTime() - next.startDate.getTime()) >
        DEDUP_START_WINDOW_MS
      )
        return false;
      const d1 = prev.durationS ?? 0;
      const d2 = next.durationS ?? 0;
      if (d1 === 0 || d2 === 0) return true; // same start, no duration to disagree
      return Math.abs(d1 - d2) / Math.max(d1, d2) <= DEDUP_DURATION_TOLERANCE;
    });
    if (dupAt === -1) {
      kept.push(next);
    } else if (dedupRank(next) < dedupRank(kept[dupAt])) {
      kept[dupAt] = next;
    }
  }
  return kept;
}

export interface DailyLoad {
  load: number;
  sources: LoadSource[];
}

/** Sum per-activity loads into local-date buckets (after dedup). */
export function dailyLoadSeries(
  activities: LoadActivity[],
  athlete: AthleteThresholds
): Map<string, DailyLoad> {
  const out = new Map<string, DailyLoad>();
  for (const a of dedupeActivities(activities)) {
    const computed = activityLoad(a, athlete);
    if (computed == null) continue;
    const key = ymdOf(a.startDateLocal ?? a.startDate);
    const day = out.get(key) ?? { load: 0, sources: [] };
    day.load = round1(day.load + computed.load);
    day.sources.push(computed.source);
    out.set(key, day);
  }
  return out;
}

function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export interface NativeDayMetrics {
  ctl: number;
  atl: number;
  /** Distinct activity days in the trailing CTL_DAYS window ending this day. */
  activityDays: number;
}

/**
 * CTL/ATL EMAs over the daily load sums, seeded 0 on the athlete's first
 * activity day, evaluated for every calendar day up to `upToDate`. Each
 * day carries its own trailing activity-day count so the MIN_LOAD_DAYS
 * calibrating gate is honest for historical recomputes too.
 */
/**
 * One day's EMA step for both CTL and ATL, given that day's load. The one
 * definition of the recurrence itself — `nativeLoadMetrics` below,
 * `race/forecast.ts`'s multi-day projection, and `morning-insight.ts`'s
 * single decay step (load: 0) all call this instead of re-deriving
 * `x + (load - x) / days` by hand. See
 * docs/specs/2026-08-10-ctl-atl-tsb-readiness-ownership-design.md.
 */
export function advanceLoadEma(
  prev: { ctl: number; atl: number },
  load: number
): { ctl: number; atl: number } {
  return {
    ctl: prev.ctl + (load - prev.ctl) / CTL_DAYS,
    atl: prev.atl + (load - prev.atl) / ATL_DAYS,
  };
}

export function nativeLoadMetrics(
  activities: LoadActivity[],
  athlete: AthleteThresholds,
  upToDate: string
): Map<string, NativeDayMetrics> {
  const daily = dailyLoadSeries(activities, athlete);
  const byDate = new Map<string, NativeDayMetrics>();
  const dates = [...daily.keys()].sort();
  if (dates.length === 0 || dates[0] > upToDate) return byDate;

  let ctl = 0;
  let atl = 0;
  const window: string[] = []; // activity days inside the trailing CTL_DAYS
  for (let day = dates[0]; day <= upToDate; day = addDays(day, 1)) {
    const load = daily.get(day)?.load ?? 0;
    ({ ctl, atl } = advanceLoadEma({ ctl, atl }, load));
    if (load > 0) window.push(day);
    const floor = addDays(day, -(CTL_DAYS - 1));
    while (window.length > 0 && window[0] < floor) window.shift();
    byDate.set(day, {
      ctl: round1(ctl),
      atl: round1(atl),
      activityDays: window.length,
    });
  }
  return byDate;
}

export interface EffectiveLoad {
  ctl: number | null;
  atl: number | null;
  source: "provider" | "computed" | null;
}

/**
 * Source precedence for one day: the provider's (intervals.icu) ctl/atl
 * pair wins when complete; the native pair fills the gap once the athlete
 * clears the MIN_LOAD_DAYS calibrating gate; otherwise nothing. Pairs are
 * never mixed — CTL and ATL from different series make a fictional TSB.
 */
export function resolveEffectiveLoad(
  provider: { ctl: number | null; atl: number | null },
  native: NativeDayMetrics | undefined
): EffectiveLoad {
  if (provider.ctl != null && provider.atl != null) {
    return { ctl: provider.ctl, atl: provider.atl, source: "provider" };
  }
  if (native != null && native.activityDays >= MIN_LOAD_DAYS) {
    return { ctl: native.ctl, atl: native.atl, source: "computed" };
  }
  return { ctl: null, atl: null, source: null };
}
