import { describe, expect, it } from "vitest";
import { withPurpose } from "@/lib/training-plan";
import { applyOffSeasonShaping } from "./off-season";

const base = [
  withPurpose({
    day: 0,
    sport: "Bike",
    type: "Intervals",
    durationMins: 60,
    intensity: "Z4-Z5",
    description: "A",
  }),
  withPurpose({
    day: 2,
    sport: "Bike",
    type: "Tempo",
    durationMins: 75,
    intensity: "Z3",
    description: "B",
  }),
  withPurpose({
    day: 4,
    sport: "Bike",
    type: "Long",
    durationMins: 120,
    intensity: "Z1-Z2",
    description: "C",
  }),
  withPurpose({
    day: 5,
    sport: "Bike",
    type: "Endurance",
    durationMins: 60,
    intensity: "Z1-Z2",
    description: "D",
  }),
];

describe("applyOffSeasonShaping", () => {
  it("off-season keeps at most one quality workout", () => {
    const out = applyOffSeasonShaping({
      workouts: base,
      seasonMode: "off_season",
      reentryStage: "none",
      targetSessions: 5,
    });
    const quality = out.workouts.filter((w) =>
      ["Intervals", "Tempo", "Brick"].includes(w.type)
    );
    expect(quality).toHaveLength(1);
    expect(out.targetSessions).toBe(4);
  });

  it("reentry week_1 removes intervals", () => {
    const out = applyOffSeasonShaping({
      workouts: base,
      seasonMode: "off_season",
      reentryStage: "week_1",
      targetSessions: 5,
    });
    expect(out.workouts.some((w) => w.type === "Intervals")).toBe(false);
  });

  it("normal mode is passthrough", () => {
    const out = applyOffSeasonShaping({
      workouts: base,
      seasonMode: "normal",
      reentryStage: "none",
      targetSessions: 5,
    });
    expect(out.workouts.map((w) => w.type)).toEqual(base.map((w) => w.type));
    expect(out.targetSessions).toBe(5);
  });
});
