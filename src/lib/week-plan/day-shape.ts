import type { DaySlot } from "./types";
import { plannedMins } from "./fill";

/** Below this a bar reads as a hairline rather than as a session. */
const MIN_HEIGHT_PCT = 12;

/**
 * The engine's own taxonomy, not the "Z4-Z5" display string: `purpose` is
 * what the planner reasons in (PURPOSE_BY_TYPE, src/lib/training-plan.ts),
 * and parsing the human-readable band would break the moment its wording
 * changes.
 */
const HARD_PURPOSES = new Set(["threshold", "vo2max"]);

/**
 * A day's bar-chart facts: how tall, how full, and the two flags that pick
 * a rendering (bar vs rest glyph, notch vs none) without the component
 * re-deriving them from raw workouts.
 */
export interface DayShape {
  mins: number;
  heightPct: number;
  hard: boolean;
  rest: boolean;
}

export function weekMaxMins(days: DaySlot[]): number {
  // plannedMins (fill.ts) is the one definition of "a day's minutes" this
  // repo enforces (tests/target-minutes-wiring.test.ts) — a second
  // hand-rolled sum here would drift from it exactly the way the rate
  // numerator/denominator drift that guard exists to catch.
  const max = Math.max(0, ...days.map((d) => plannedMins([d])));
  // Never zero: the caller divides by this, and a week with nothing planned
  // is a real state (a new athlete, an off-season week).
  return max > 0 ? max : 1;
}

export function dayShape(day: DaySlot, maxMins: number): DayShape {
  const mins = plannedMins([day]);
  const rest = day.workouts.length === 0;
  const raw = (mins / maxMins) * 100;
  return {
    mins,
    heightPct: rest ? 0 : Math.max(MIN_HEIGHT_PCT, Math.min(100, raw)),
    hard: day.workouts.some((w) => HARD_PURPOSES.has(w.purpose)),
    rest,
  };
}
