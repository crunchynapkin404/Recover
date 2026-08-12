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

/**
 * How many trailing nights the debt accounting window covers.
 * Source: Invented — a design choice, not cited research.
 * Confidence: Low.
 */
export const DEBT_WINDOW_DAYS = 14;
/**
 * Below this many recorded nights, report nothing rather than a thin number.
 * Source: Invented — a data-sufficiency gate.
 * Confidence: Low.
 */
export const MIN_DEBT_DAYS = 7;
/**
 * One night cannot repay a week. Cap the recommendation at something
 * doable: six hours of debt cannot be repaid tonight, and recommending a
 * 01:00 bedtime shift would be advice no one follows (see
 * docs/specs/2026-07-16-v0.9.0-honest-body-intelligence-design.md Part 2).
 * Source: Invented — an actionability design choice, not a physiological
 * claim.
 * Confidence: Low.
 */
export const MAX_NIGHTLY_PAYBACK_SECS = 3600;
/**
 * A target the athlete can change — not a claim about them (see
 * docs/specs/2026-07-16-v0.9.0-honest-body-intelligence-design.md Part 2:
 * "sleepNeedSecs defaults to 8h legitimately... not a claim about them").
 * 8h sits inside the commonly-cited 7-9h/night range recommended for
 * adults.
 * Source: Sleep-health guidance (7-9h/night adult range), as an editable
 * default rather than a personalized measurement.
 * Confidence: Medium.
 */
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

/**
 * Below this many real bedtimes, fall back to the wake-time anchor.
 * Source: Invented — a data-sufficiency gate.
 * Confidence: Low.
 */
export const MIN_BEDTIME_SAMPLES = 5;

export interface SleepDebtResult {
  /** null = not enough data. */
  debtSecs: number | null;
  nightsCounted: number;
  /** Data quality confidence for the debt estimate. */
  confidence: "none" | "low" | "medium" | "high";
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

/**
 * The one owner of the sleep-debt display string. `app/page.tsx`'s vitals
 * grid and `BedtimeCard` both render this figure on the same screen, and a
 * second copy previously drifted: it is a 14-night cumulative deficit, so
 * it routinely runs to hours. Minutes stay minutes while they read
 * naturally; past 90 it switches to hours rather than printing
 * "debt 1359m".
 */
export function formatSleepDebt(debtSecs: number): string {
  const mins = Math.round(debtSecs / 60);
  if (mins < 90) return `debt ${mins}m`;
  // Round to tenths-of-an-hour as an integer before dividing back to a
  // decimal string. `(mins / 60).toFixed(1)` looks equivalent but isn't:
  // for mins=1359, mins/60 is the double 22.649999999999998… (not exactly
  // representable), so toFixed rounds it down to "22.6" instead of the
  // mathematically correct "22.7". mins/6 lands exactly on the .5 boundary
  // when it matters, so Math.round resolves it correctly every time.
  const tenths = Math.round(mins / 6);
  return `debt ${(tenths / 10).toFixed(1)}h · ${DEBT_WINDOW_DAYS}d`;
}

/**
 * `ymd` minus `days`, as a YYYY-MM-DD string. Built from the given date
 * only — never the system clock — so the owner below stays pure.
 */
function subtractDaysYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * The one owner of sleep debt's inputs. Both `app/page.tsx` and
 * `app/body/page.tsx` built this assembly independently (same 14-day date
 * filter, same bedStart → clock-minutes mapping, same prefs fallbacks) —
 * see docs/specs/2026-08-11-display-derived-figures-ownership-design.md
 * section 1. This is now the single place that definition lives.
 *
 * The date window is enforced HERE, not left to computeSleepDebt's internal
 * `slice(-DEBT_WINDOW_DAYS)`. That slice takes the last 14 *elements*; with
 * sparse wellness (gaps, a new athlete, a provider outage) the last 14 real
 * *days* and the last 14 rows are different sets, and only the date filter
 * gives the true 14-day figure. The slice stays as a safety net, not the
 * definition — see the design doc for the full argument.
 *
 * Pure: `today` is a parameter rather than `new Date()`, so this stays
 * testable without mocking the clock.
 */
export function sleepDebtFrom(
  wellness: Array<{
    date: string;
    sleepSecs: number | null;
    bedStart: Date | null;
  }>,
  prefs: { sleepNeedSecs: number | null; wakeTime: string | null } | null,
  today: string
): SleepDebtResult {
  const cutoff = subtractDaysYmd(today, DEBT_WINDOW_DAYS);
  const inWindow = wellness.filter((w) => w.date >= cutoff);

  const bedtimes = inWindow
    .filter((w): w is typeof w & { bedStart: Date } => w.bedStart != null)
    .map((w) => w.bedStart.getHours() * 60 + w.bedStart.getMinutes());

  return computeSleepDebt({
    nights: inWindow.map((w) => ({ sleepSecs: w.sleepSecs })),
    sleepNeedSecs: prefs?.sleepNeedSecs ?? DEFAULT_SLEEP_NEED_SECS,
    wakeTime: prefs?.wakeTime ?? null,
    bedtimes,
  });
}

export function computeSleepDebt(input: SleepDebtInput): SleepDebtResult {
  const recorded = input.nights
    .slice(-DEBT_WINDOW_DAYS)
    .filter((n): n is { sleepSecs: number } => n.sleepSecs != null);

  if (recorded.length < MIN_DEBT_DAYS) {
    return {
      debtSecs: null,
      nightsCounted: recorded.length,
      confidence: "none",
      bedtime: null,
    };
  }

  const debtSecs = recorded.reduce(
    (sum, n) => sum + Math.max(0, input.sleepNeedSecs - n.sleepSecs),
    0
  );

  const payback = Math.min(debtSecs, MAX_NIGHTLY_PAYBACK_SECS);
  const confidence =
    recorded.length <= 9 ? "low" : recorded.length <= 12 ? "medium" : "high";

  // v0.12: with enough real bedtimes, anchor on the athlete's habitual
  // bedtime and nudge it earlier by any outstanding debt — a target built
  // from their actual schedule rather than wake-time arithmetic.
  if (input.bedtimes != null && input.bedtimes.length >= MIN_BEDTIME_SAMPLES) {
    const median = circularMedianEvening(input.bedtimes);
    return {
      debtSecs,
      nightsCounted: recorded.length,
      confidence,
      bedtime: formatHhMm(median - payback / 60),
    };
  }

  const wakeMinutes = input.wakeTime != null ? parseHhMm(input.wakeTime) : null;
  if (wakeMinutes == null) {
    return {
      debtSecs,
      nightsCounted: recorded.length,
      confidence,
      bedtime: null,
    };
  }

  const needMinutes = (input.sleepNeedSecs + payback) / 60;

  return {
    debtSecs,
    nightsCounted: recorded.length,
    confidence,
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
