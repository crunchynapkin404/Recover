/**
 * How closely one day matched what the plan asked of it, as a percentage.
 *
 * `weekAdherencePct` one level down, and deliberately the same shape: the
 * day's target is the week's own load-per-minute rate applied to the day's
 * planned minutes, which is exactly what `openWeekPlannedLoads` projects the
 * week ahead with. Deriving a second per-day target — the week's target over
 * seven, or over the session count — would make the day's score and the
 * week's projection two different answers to one question.
 *
 * REPORTED, NEVER ACTED ON. Nothing in the engine reads this figure, and it
 * should stay that way: a number the plan reacts to is a number worth gaming,
 * and the week-level `adherencePct` already carries the one the safety rails
 * consult.
 *
 * Pure — no I/O, no clock.
 */
import { Figure } from "@/lib/uncertainty";
import { weekLoadPerMin } from "./volume";

export interface DayAdherence {
  /** actual ÷ planned × 100, rounded. Uncapped in both directions. */
  pct: number;
  plannedLoad: number;
  actualLoad: number;
}

export interface DayAdherenceInput {
  /** The week's target as it finally stood — post-taper, post-hours-budget. */
  effectiveTarget: number | null;
  /** Minutes the week materialized. Null or 0 → no rate exists. */
  materializedMins: number | null;
  /** This day's planned minutes. */
  plannedMins: number;
  /**
   * Booked load for the day. NULL means no activity has been booked yet and
   * is NOT zero — `bookWeekActuals` clears rather than zeroes precisely so
   * the two stay distinguishable, and "ridden at 0% of plan" is a claim the
   * app cannot defend about a ride that has not synced.
   */
  actualLoad: number | null;
}

const WHY =
  "Measured against this day's share of the week's target, at the same " +
  "load-per-minute rate the week is planned with.";

export function dayAdherence(input: DayAdherenceInput): Figure<DayAdherence> {
  const { plannedMins, actualLoad } = input;

  if (plannedMins <= 0) {
    return Figure.notApplicable(
      "There was nothing planned for this day, so there is no plan to have followed."
    );
  }

  const perMin = weekLoadPerMin(input);
  if (perMin == null) {
    return Figure.missingInput("this week's load target");
  }

  if (actualLoad == null) {
    return Figure.missingInput("the activity for this day, once it has synced");
  }

  const plannedLoad = Math.round(perMin * plannedMins);
  if (plannedLoad <= 0) {
    return Figure.notApplicable(
      "This day's share of the week's target rounds to nothing, so a percentage of it would not mean anything."
    );
  }

  return Figure.available(
    {
      // Uncapped on purpose, both ways. A clamp would tell an athlete who
      // rode double the session that they rode exactly the session, and
      // nothing consumes this number, so there is no reason to flatten it.
      pct: Math.round((actualLoad / plannedLoad) * 100),
      plannedLoad,
      actualLoad,
    },
    // The rate is a week-level average applied to one day — the same
    // assumption openWeekPlannedLoads already makes, and it says so there.
    "low",
    WHY
  );
}
