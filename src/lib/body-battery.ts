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

/**
 * Points of drain spread across a full waking day. Source:
 * `docs/specs/2026-07-16-v0.9.0-honest-body-intelligence-design.md`, which
 * calls this and `DRAIN_PER_LOAD` "first-pass calibrations" headed for
 * revisiting once compared against real activity/readiness data (a v0.9.2
 * correlation-engine question, per that doc's own hand-off). Confidence:
 * Low.
 */
export const AWAKE_DRAIN_TOTAL = 25;
/** Battery points per unit of training load: a 100-load session costs 35.
 *  Source: same design doc, same "first-pass calibration" caveat.
 *  Confidence: Low. */
export const DRAIN_PER_LOAD = 0.35;
/**
 * Waking-window shape used when the athlete has set no wake time. Source:
 * a common-sense fallback clock time (07:00), not measured data — same
 * design doc. Confidence: Low.
 */
export const DEFAULT_WAKE_MINUTES = 420; // 07:00
/** Fallback bedtime (23:00) when unset. Same rationale as
 *  DEFAULT_WAKE_MINUTES. Confidence: Low. */
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
  /** Optional sleep debt drain that lowers the day's starting charge. */
  sleepDebtSecs?: number | null;
  wakeMinutes: number;
  bedMinutes: number;
  activities: BatteryActivity[];
  /** Clip the curve here (now, for today; 1440 for a past day). */
  nowMinutes: number;
}

export interface BodyBatteryCheckpoint {
  label: "Morning" | "Midday" | "Evening";
  minutes: number;
  charge: number;
}

export interface BodyBatteryResult {
  /** null = not enough data. Never a default. */
  current: number | null;
  /** Empty when current is null. */
  points: BatteryPoint[];
  /** Deterministic labels for the athlete's day shape. */
  tags: string[];
  /** Morning/midday/evening readouts derived from the curve. */
  checkpoints: BodyBatteryCheckpoint[];
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

/**
 * Cumulative awake drain at t — linear across the waking window.
 *
 * `bed` is a wall-clock minute (0..1439) from `typicalBedMinutes`, which
 * wraps across midnight. Whenever the derived bedtime falls at or before
 * `wake` (e.g. wake 08:00, bed 00:00), it actually means "tomorrow" — unwrap
 * it forward by a full day before computing the span, or the span collapses
 * to ~1 minute and the entire drain lands on the first minute after waking.
 */
function awakeDrainAt(t: number, wake: number, bed: number): number {
  if (t <= wake) return 0;
  const bedAdj = bed <= wake ? bed + MINUTES_PER_DAY : bed;
  const span = Math.max(1, bedAdj - wake);
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
  if (input.readiness == null) {
    return { current: null, points: [], tags: [], checkpoints: [] };
  }

  const sleepDebtPenalty = clamp(
    ((input.sleepDebtSecs ?? 0) / 3600) * 2,
    0,
    20
  );
  const start = clamp(input.readiness - sleepDebtPenalty, 0, 100);
  const end = clamp(input.nowMinutes, 0, MINUTES_PER_DAY);
  const points: BatteryPoint[] = [];

  // One formula for both the sampled curve and the checkpoints, so the tiles
  // can never disagree with the line they annotate.
  const chargeAt = (t: number) =>
    Math.round(
      clamp(
        start -
          (awakeDrainAt(t, input.wakeMinutes, input.bedMinutes) +
            activityDrainAt(t, input.activities)),
        0,
        100
      )
    );

  for (let t = 0; t <= end; t += SAMPLE_INTERVAL_MIN) {
    points.push({ minutes: t, charge: chargeAt(t) });
  }

  // Evaluated at the real minute, not looked up in the sample grid. v0.63
  // matched `points.find(pt => pt.minutes === p.minutes)` against a
  // 15-minute grid, so any wake time off :00/:15/:30/:45 missed on all
  // three checkpoints at once (they share the same offset) and every tile
  // fell through to the last sampled point — three identical numbers
  // labelled Morning, Midday and Evening.
  const checkpoints = (
    [
      { label: "Morning" as const, minutes: input.wakeMinutes },
      { label: "Midday" as const, minutes: input.wakeMinutes + 6 * 60 },
      { label: "Evening" as const, minutes: input.wakeMinutes + 12 * 60 },
    ] as const
  )
    .filter((p) => p.minutes <= end)
    .map((p) => ({ ...p, charge: chargeAt(p.minutes) }));

  const tags = new Set<string>();
  if (input.activities.length === 0) tags.add("rest day");
  if (input.activities.length > 1) tags.add("double day");
  if (
    input.activities.some((a) => a.load >= 100) ||
    input.activities.reduce((s, a) => s + a.load, 0) >= 100
  )
    tags.add("hard day");
  if (input.activities.some((a) => a.startMinutes >= 18 * 60))
    tags.add("late session");
  if ((input.sleepDebtSecs ?? 0) >= 3600) tags.add("sleep debt");

  return {
    current: points.at(-1)?.charge ?? null,
    points,
    tags: [...tags],
    checkpoints,
  };
}
