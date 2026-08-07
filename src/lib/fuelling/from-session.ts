import type { ScheduledWorkout } from "@/lib/week-plan/types";
import type { FuellingInput, FuellingGuidance } from "./types";
import { calculateFuellingGuidance } from "./calculate";

export function fuellingInputFromSession(
  workout: Pick<ScheduledWorkout, "durationMins" | "intensity" | "type">,
  bodyMassKg: number | null
): FuellingInput {
  return {
    durationMins: workout.durationMins,
    intensity: workout.intensity,
    type: workout.type,
    bodyMassKg,
  };
}

export function fuellingFromSession(
  workout: Pick<ScheduledWorkout, "durationMins" | "intensity" | "type">,
  bodyMassKg: number | null
): FuellingGuidance {
  return calculateFuellingGuidance(fuellingInputFromSession(workout, bodyMassKg));
}
