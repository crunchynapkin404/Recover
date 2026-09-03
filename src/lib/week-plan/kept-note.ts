import type { AdjustmentRecord, DaySlot, ScheduledWorkout } from "./types";
import { isQuality } from "./types";
import { isAthleteChosen } from "./placement";
import type { Band } from "@/lib/readiness";

/**
 * What the engine says when it would have changed an athlete-chosen session
 * and was not allowed to.
 *
 * The immunity guards make Recover comply; this makes it comply OUT LOUD. The
 * athlete asked for the agency and gets it — what they do not get is silence
 * from a coach that disagrees. `before` and `after` are the same day on
 * purpose: this record exists to explain a NON-change, which is why it needed
 * its own action rather than reusing "scaled" or "dropped".
 *
 * Returns null far more often than not. A note on every chosen session would
 * be noise, and noise is how a real warning gets ignored — so the engine
 * speaks only where it genuinely disagrees.
 */
export function keptNote(
  day: DaySlot,
  workout: ScheduledWorkout,
  band: Band
): AdjustmentRecord | null {
  if (!isAthleteChosen(workout)) return null;

  const unchanged = [{ ...day, workouts: day.workouts.map((w) => ({ ...w })) }];
  const base = {
    date: day.date,
    trigger: "athlete_choice" as const,
    action: "kept" as const,
    before: unchanged,
    after: unchanged,
  };

  // Pre-race rest is reported ahead of the band: it is the more consequential
  // of the two, and it names the reason the day was empty in the first place.
  if (day.restIntent === "pre_race") {
    return {
      ...base,
      reason:
        `Kept ${workout.type} (${workout.durationMins} min) — your choice. ` +
        `This day was left clear to freshen you for your race.`,
      reasonCode: "chosen_on_pre_race_rest",
      context: {
        workoutType: workout.type,
        durationMins: workout.durationMins,
        restIntent: "pre_race",
      },
    };
  }

  // Only quality picks. Choosing a recovery spin on a red day is agreement,
  // not defiance, and there is nothing to warn about.
  if (band === "red" && isQuality(workout)) {
    return {
      ...base,
      reason:
        `Kept ${workout.type} (${workout.durationMins} min) — your choice. ` +
        `Today's readiness is red, so this is harder than recommended.`,
      reasonCode: "chosen_kept_on_red",
      context: {
        workoutType: workout.type,
        durationMins: workout.durationMins,
        band,
      },
    };
  }

  return null;
}
