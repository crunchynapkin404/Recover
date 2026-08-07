import { describe, expect, it } from "vitest";
import { withPurpose } from "@/lib/training-plan";
import type { DaySlot } from "@/lib/week-plan/types";
import { fuellingFromSession } from "@/lib/fuelling/from-session";
import { mapDaysWithFuelling } from "./get-week-plan";

function day(date: string, workouts: DaySlot["workouts"]): DaySlot {
  return {
    date,
    availableBlocks: [
      {
        start: "18:00",
        end: "19:00",
        mins: 60,
        energy: "normal",
        sports: null,
      },
    ],
    workouts,
    availableMins: 60,
    status: workouts.length > 0 ? "planned" : "rest",
  };
}

describe("mapDaysWithFuelling", () => {
  it("attaches fuelling guidance using the shared engine output", () => {
    const workout = withPurpose({
      day: 0,
      sport: "Bike",
      type: "Tempo",
      durationMins: 80,
      intensity: "Z3",
      description: "steady work",
      blockIdx: 0,
    });

    const out = mapDaysWithFuelling([day("2026-08-10", [workout])], 70);
    const guided = out[0].workouts[0];

    expect(guided.fuelling).toEqual(fuellingFromSession(workout, 70));
  });

  it("is deterministic for same days and same body mass", () => {
    const workout = withPurpose({
      day: 1,
      sport: "Run",
      type: "Endurance",
      durationMins: 45,
      intensity: "Z1-Z2",
      description: "easy run",
      blockIdx: 0,
    });

    const days = [day("2026-08-11", [workout])];
    const a = mapDaysWithFuelling(days, null);
    const b = mapDaysWithFuelling(days, null);

    expect(a).toEqual(b);
  });
});
