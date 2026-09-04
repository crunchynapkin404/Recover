import { fuellingFromSession } from "./from-session";
import type { ScheduledWorkout } from "@/lib/week-plan/types";

/**
 * The one line that replaces the open FuellingCard on the Week page.
 *
 * TWO SESSIONS COUNT RATHER THAN COMPETE. A day holds up to two, and their
 * before-figures differ; rendering the first would put a number next to a
 * session it does not describe. The count is honest and the `ⓘ` holds both.
 */
export function fuellingSummary(
  workouts: ScheduledWorkout[],
  bodyMassKg: number | null
): string | null {
  if (workouts.length === 0) return null;
  if (workouts.length > 1) return `Fuelling: ${workouts.length} sessions`;
  const { before } = fuellingFromSession(workouts[0], bodyMassKg);
  return `Fuelling: ${before.carbsG.min}-${before.carbsG.max} g carbs before`;
}
