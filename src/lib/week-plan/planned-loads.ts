// Projecting a week's remaining days as load. Pure — no DB, no clock; the
// caller resolves the rate and passes today in.
import type { DaySlot } from "./types";

/** Statuses whose sessions are still ahead of the athlete. */
function isForecastable(d: DaySlot): boolean {
  return (
    d.workouts.length > 0 &&
    (d.status === "planned" || d.status === "moved" || d.status === "adapted")
  );
}

function dayWorkoutMins(d: DaySlot): number {
  return d.workouts.reduce((s, x) => s + (x.durationMins ?? 0), 0);
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Each future day of the open week, with the load it is projected to carry.
 *
 * When `perMin` is known, a day's load is simply its own minutes at that
 * rate — nothing about one day depends on any other. This replaces
 * distributing a week total across the week's remaining minutes, which made
 * every day's figure move whenever any other day changed, and which let a
 * session added mid-week quietly shrink the sessions already there.
 *
 * It also drops a redistribution that formula performed by accident: a
 * completed day was removed from the divisor but its share of the week's
 * target was not removed from the total, so future days inherited load that
 * earlier days had already absorbed.
 *
 * `perMin` is null only for rows written before `materialized_mins` existed.
 * Those keep the previous behaviour exactly, rather than projecting nothing.
 */
export function openWeekPlannedLoads(input: {
  days: DaySlot[];
  perMin: number | null;
  fallbackTarget: number;
  today: string;
}): { date: string; load: number }[] {
  const { days, perMin, fallbackTarget, today } = input;
  const future = days.filter((d) => isForecastable(d) && d.date > today);

  if (perMin != null) {
    return future.map((d) => ({
      date: d.date,
      load: round1(perMin * dayWorkoutMins(d)),
    }));
  }

  const totalMins = days
    .filter(isForecastable)
    .reduce((s, d) => s + dayWorkoutMins(d), 0);
  if (totalMins === 0) return [];
  return future.map((d) => ({
    date: d.date,
    load: round1(fallbackTarget * (dayWorkoutMins(d) / totalMins)),
  }));
}
