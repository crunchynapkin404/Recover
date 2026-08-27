import type { DaySlot } from "./types";

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

/**
 * A day's DISPLAY minutes: how long the athlete is actually occupied,
 * strength included. Deliberately NOT `plannedMins` (fill.ts) — that is
 * the engine's TARGET/load minutes, and excludes strength on purpose (an
 * endurance-only load-per-minute rate must never be multiplied by a
 * lift's duration; see plannedMins' own comment). This strip only ever
 * draws a bar — it never feeds a rate or a target — so a strength-only
 * day belongs at its own height. Using plannedMins here summed a
 * 90-minute strength day to 0, which floors to MIN_HEIGHT_PCT exactly
 * like a 5-minute one: the height was simply wrong, not just imprecise.
 *
 * Do NOT "fix" this back to plannedMins. tests/target-minutes-wiring.test.ts
 * allowlists this file for exactly this reason — see that test's own
 * comment for why a display-only sum is not the drift it exists to catch.
 */
function displayMins(day: DaySlot): number {
  return day.workouts.reduce((total, w) => total + w.durationMins, 0);
}

export function weekMaxMins(days: DaySlot[]): number {
  const max = Math.max(0, ...days.map((d) => displayMins(d)));
  // Never zero: the caller divides by this, and a week with nothing planned
  // is a real state (a new athlete, an off-season week).
  return max > 0 ? max : 1;
}

export function dayShape(day: DaySlot, maxMins: number): DayShape {
  const mins = displayMins(day);
  const rest = day.workouts.length === 0;
  const raw = (mins / maxMins) * 100;
  return {
    mins,
    heightPct: rest ? 0 : Math.max(MIN_HEIGHT_PCT, Math.min(100, raw)),
    hard: day.workouts.some((w) => HARD_PURPOSES.has(w.purpose)),
    rest,
  };
}
