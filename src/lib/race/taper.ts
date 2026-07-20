// src/lib/race/taper.ts — pure taper math. No db, no I/O (Principle 1).
import type { PlannedWorkout } from "@/lib/training-plan";

export interface RaceContext {
  date: string; // YYYY-MM-DD
  priority: "A" | "B" | "C";
  raceType: string;
  name: string;
}

/** Taper window length by race distance class. */
export const TAPER_WINDOW_LONG = 21; // marathon / full ironman
export const TAPER_WINDOW_MID = 14; // half / 70.3 / fondo / century
export const TAPER_WINDOW_SHORT = 10; // short course

/** Weekly load as a fraction of the athlete's current actual load. */
export const TAPER_FRACTION_RACE_WEEK = 0.45;
export const TAPER_FRACTION_WEEK_1 = 0.65;
export const TAPER_FRACTION_WEEK_2 = 0.8;

/** Longest session allowed the day before a race (the "opener"). */
export const OPENER_MAX_MINS = 30;

export function taperWindowDays(raceType: string): number {
  const rt = raceType.toLowerCase();
  if (rt.includes("70.3") || rt.includes("half")) return TAPER_WINDOW_MID;
  if (rt.includes("marathon") || rt.includes("ironman"))
    return TAPER_WINDOW_LONG;
  if (rt.includes("fondo") || rt.includes("century")) return TAPER_WINDOW_MID;
  return TAPER_WINDOW_SHORT;
}

function daysBetween(fromYmd: string, toYmd: string): number {
  return Math.round(
    (new Date(toYmd + "T00:00:00").getTime() -
      new Date(fromYmd + "T00:00:00").getTime()) /
      86_400_000
  );
}

/**
 * Which taper fraction applies to the week starting `weekStart`, or null
 * when the week is outside the race's taper window (no reshaping).
 */
export function taperFractionForWeek(
  weekStart: string,
  race: RaceContext
): number | null {
  const d = daysBetween(weekStart, race.date);
  if (d < 0) return null;
  const window = taperWindowDays(race.raceType);
  if (d <= 6) return TAPER_FRACTION_RACE_WEEK;
  if (d <= 13 && window >= TAPER_WINDOW_MID) return TAPER_FRACTION_WEEK_1;
  if (d <= 20 && window >= TAPER_WINDOW_LONG) return TAPER_FRACTION_WEEK_2;
  return null;
}

/**
 * Race-week sessions: volume is gone, intensity touches stay. One short
 * easy session 3 days out, race openers 2 days out, nothing the day
 * before (rest), race day handled by the caller as a race slot.
 */
export function raceWeekWorkouts(
  sport: string,
  raceDayIdx: number
): PlannedWorkout[] {
  const workouts: PlannedWorkout[] = [];
  if (raceDayIdx >= 3) {
    workouts.push({
      day: raceDayIdx - 3,
      sport,
      type: "Endurance",
      durationMins: 30,
      intensity: "Z1-Z2",
      description: "Short easy session — race week, stay loose",
    });
  }
  if (raceDayIdx >= 2) {
    workouts.push({
      day: raceDayIdx - 2,
      sport,
      type: "Tempo",
      durationMins: 20,
      intensity: "Z3",
      description: "Race openers: 3×90s at race effort, full recovery",
    });
  }
  return workouts;
}
