/**
 * Body battery — an explicitly modelled energy estimate, not a measurement.
 *
 * The charge starts each day at the morning readiness score and only ever
 * declines. That is deliberate: detecting daytime recovery needs intraday HR,
 * which no connected provider gives us. Overnight recovery is expressed as the
 * NEXT day's readiness — where tomorrow's curve starts — rather than modelled
 * as a rebound we cannot observe.
 *
 * The constants below are calibration choices, not measurements. They shape
 * how drain is distributed; they assert nothing about a particular athlete.
 * See docs/specs/2026-07-16-v0.9.0-honest-body-intelligence-design.md.
 */

/** Points of drain spread across a full waking day. */
export const AWAKE_DRAIN_TOTAL = 25;
/** Battery points per unit of training load: a 100-load session costs 35. */
export const DRAIN_PER_LOAD = 0.35;
/** Waking-window shape used when the athlete has set no wake time. */
export const DEFAULT_WAKE_MINUTES = 420; // 07:00
export const DEFAULT_BED_MINUTES = 1380; // 23:00

/** Curve resolution: 15 min → 97 points across a full day. */
const SAMPLE_INTERVAL_MIN = 15;
const MINUTES_PER_DAY = 1440;

export interface BatteryPoint {
  /** Minutes past local midnight, 0..1440. */
  minutes: number;
  /** 0..100. */
  charge: number;
}

export interface BatteryActivity {
  startMinutes: number;
  durationMin: number;
  load: number;
}

export interface BodyBatteryInput {
  /** Morning readiness. null → calibrating; the model returns nothing. */
  readiness: number | null;
  wakeMinutes: number;
  bedMinutes: number;
  activities: BatteryActivity[];
  /** Clip the curve here (now, for today; 1440 for a past day). */
  nowMinutes: number;
}

export interface BodyBatteryResult {
  /** null = not enough data. Never a default. */
  current: number | null;
  /** Empty when current is null. */
  points: BatteryPoint[];
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Wrap arbitrary minutes (possibly negative, possibly >= 1440) into 0..1439. */
function wrapMinutes(m: number): number {
  return ((m % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

/**
 * The athlete's typical bedtime, derived from their own wake time and sleep
 * need — a fact about their schedule, not a debt-repayment recommendation.
 * Wraps correctly across midnight (e.g. wake 07:00 with an 8h need → 23:00
 * the previous day).
 */
export function typicalBedMinutes(
  wakeMinutes: number,
  sleepNeedSecs: number
): number {
  return wrapMinutes(wakeMinutes - sleepNeedSecs / 60);
}

/** Cumulative awake drain at t — linear across the waking window. */
function awakeDrainAt(t: number, wake: number, bed: number): number {
  if (t <= wake) return 0;
  const span = Math.max(1, bed - wake);
  return AWAKE_DRAIN_TOTAL * clamp((t - wake) / span, 0, 1);
}

/** Cumulative activity drain at t — each session spread over its duration. */
function activityDrainAt(t: number, activities: BatteryActivity[]): number {
  let total = 0;
  for (const a of activities) {
    const dur = Math.max(1, a.durationMin);
    const elapsed = clamp(t - a.startMinutes, 0, dur);
    total += a.load * DRAIN_PER_LOAD * (elapsed / dur);
  }
  return total;
}

export function computeBodyBattery(input: BodyBatteryInput): BodyBatteryResult {
  if (input.readiness == null) return { current: null, points: [] };

  const start = clamp(input.readiness, 0, 100);
  const end = clamp(input.nowMinutes, 0, MINUTES_PER_DAY);
  const points: BatteryPoint[] = [];

  for (let t = 0; t <= end; t += SAMPLE_INTERVAL_MIN) {
    const drain =
      awakeDrainAt(t, input.wakeMinutes, input.bedMinutes) +
      activityDrainAt(t, input.activities);
    points.push({
      minutes: t,
      charge: Math.round(clamp(start - drain, 0, 100)),
    });
  }

  return { current: points.at(-1)?.charge ?? null, points };
}
