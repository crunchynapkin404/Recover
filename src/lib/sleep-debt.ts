/**
 * Sleep debt — cumulative deficit against the athlete's own target.
 *
 * Two deliberate choices, both about not inventing data:
 *
 *  - Nights with no sleep record are SKIPPED, never counted as zero deficit.
 *    146 of the owner's 368 wellness days have no sleep row (verified against
 *    the live DB); treating those as perfect nights would quietly understate
 *    debt.
 *  - A surplus does not offset a deficit. Sleeping 10h on Sunday does not
 *    repay Wednesday, and modelling it as though it does is a tidy fiction.
 *
 * Pure: no db, no I/O.
 */

export const DEBT_WINDOW_DAYS = 14;
/** Below this many recorded nights, report nothing rather than a thin number. */
export const MIN_DEBT_DAYS = 7;
/** One night cannot repay a week. Cap the recommendation at something doable. */
export const MAX_NIGHTLY_PAYBACK_SECS = 3600;
/** A target the athlete can change — not a claim about them. */
export const DEFAULT_SLEEP_NEED_SECS = 28800; // 8h

export interface SleepDebtInput {
  /** Most recent last. Longer lists are truncated to the window. */
  nights: Array<{ sleepSecs: number | null }>;
  sleepNeedSecs: number;
  /** "HH:MM" local, or null when the athlete has not told us. */
  wakeTime: string | null;
  /**
   * v0.12 bedtime v2: recent provider bed-start clock minutes (from local
   * midnight). When present, the target anchors on the athlete's real
   * habitual bedtime instead of wake-time − need. Absent → today's
   * wake-time behavior exactly.
   */
  bedtimes?: number[];
}

/** Below this many real bedtimes, fall back to the wake-time anchor. */
export const MIN_BEDTIME_SAMPLES = 5;

export interface SleepDebtResult {
  /** null = not enough data. */
  debtSecs: number | null;
  nightsCounted: number;
  /** "HH:MM", or null when wakeTime is unset or malformed. */
  bedtime: string | null;
}

const MINUTES_PER_DAY = 1440;

function parseHhMm(v: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

function formatHhMm(minutes: number): string {
  // debtSecs is a sum of real per-second sleep durations, so `minutes` is
  // frequently fractional. Round to a whole minute here so the "HH:MM"
  // contract holds for any numeric input, not just whole-minute callers.
  const rounded = Math.round(minutes);
  const m = ((rounded % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const h = Math.floor(m / 60);
  return `${String(h).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export function computeSleepDebt(input: SleepDebtInput): SleepDebtResult {
  const recorded = input.nights
    .slice(-DEBT_WINDOW_DAYS)
    .filter((n): n is { sleepSecs: number } => n.sleepSecs != null);

  if (recorded.length < MIN_DEBT_DAYS) {
    return { debtSecs: null, nightsCounted: recorded.length, bedtime: null };
  }

  const debtSecs = recorded.reduce(
    (sum, n) => sum + Math.max(0, input.sleepNeedSecs - n.sleepSecs),
    0
  );

  const payback = Math.min(debtSecs, MAX_NIGHTLY_PAYBACK_SECS);

  // v0.12: with enough real bedtimes, anchor on the athlete's habitual
  // bedtime and nudge it earlier by any outstanding debt — a target built
  // from their actual schedule rather than wake-time arithmetic.
  if (input.bedtimes != null && input.bedtimes.length >= MIN_BEDTIME_SAMPLES) {
    const median = circularMedianEvening(input.bedtimes);
    return {
      debtSecs,
      nightsCounted: recorded.length,
      bedtime: formatHhMm(median - payback / 60),
    };
  }

  const wakeMinutes = input.wakeTime != null ? parseHhMm(input.wakeTime) : null;
  if (wakeMinutes == null) {
    return { debtSecs, nightsCounted: recorded.length, bedtime: null };
  }

  const needMinutes = (input.sleepNeedSecs + payback) / 60;

  return {
    debtSecs,
    nightsCounted: recorded.length,
    bedtime: formatHhMm(wakeMinutes - needMinutes),
  };
}

/**
 * Median of evening/after-midnight bedtimes. After-midnight times (before
 * noon) are lifted by a day so a 00:30 sorts after a 23:00, then the median
 * is folded back into a 0–1439 clock minute.
 */
function circularMedianEvening(mins: number[]): number {
  const normalized = mins.map((m) =>
    m < MINUTES_PER_DAY / 2 ? m + MINUTES_PER_DAY : m
  );
  const sorted = [...normalized].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  return ((median % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}
