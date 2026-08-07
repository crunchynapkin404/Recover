import { describe, expect, it } from "vitest";
import { withPurpose } from "@/lib/training-plan";
import type { DaySlot } from "@/lib/week-plan/types";
import { exportWeekToZwo } from "./week";

function day(date: string, workouts: DaySlot["workouts"]): DaySlot {
  return {
    date,
    availableBlocks: [
      { start: "18:00", end: "19:00", mins: 60, energy: "normal", sports: null },
    ],
    workouts,
    availableMins: 60,
    status: workouts.length > 0 ? "planned" : "rest",
  };
}

describe("exportWeekToZwo", () => {
  it("exports only bike workouts and keeps deterministic ordering", () => {
    const bikeA = withPurpose({
      day: 0,
      sport: "Bike",
      type: "Endurance",
      durationMins: 60,
      intensity: "Z1-Z2",
      description: "A",
      blockIdx: 0,
    });
    const run = withPurpose({
      day: 1,
      sport: "Run",
      type: "Tempo",
      durationMins: 40,
      intensity: "Z3",
      description: "R",
      blockIdx: 0,
    });
    const bikeB = withPurpose({
      day: 2,
      sport: "Bike",
      type: "Intervals",
      durationMins: 50,
      intensity: "Z4-Z5",
      description: "B",
      blockIdx: 0,
    });

    const out = exportWeekToZwo([
      day("2026-08-10", [bikeA]),
      day("2026-08-11", [run]),
      day("2026-08-12", [bikeB]),
    ]);

    expect(out.exports).toHaveLength(2);
    expect(out.refusals).toHaveLength(1);
    expect(out.exports[0]?.fileName).toContain("2026-08-10");
    expect(out.exports[1]?.fileName).toContain("2026-08-12");
  });

  it("is deterministic for identical week input", () => {
    const bike = withPurpose({
      day: 0,
      sport: "Bike",
      type: "Tempo",
      durationMins: 75,
      intensity: "Z3",
      description: "steady",
      blockIdx: 0,
    });

    const days = [day("2026-08-10", [bike])];

    const a = exportWeekToZwo(days);
    const b = exportWeekToZwo(days);

    expect(a).toEqual(b);
  });
});
