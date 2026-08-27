import { describe, expect, it } from "vitest";
import { dayShape, weekMaxMins } from "./day-shape";
import type { DaySlot, ScheduledWorkout } from "./types";

const slot = (over: Partial<DaySlot> = {}): DaySlot => ({
  date: "2026-08-27",
  availableBlocks: [],
  workouts: [],
  availableMins: 0,
  status: "planned",
  ...over,
});

const w = (durationMins: number, purpose: string) =>
  ({
    durationMins,
    purpose,
    day: 3,
    sport: "Ride",
    type: "Endurance",
    intensity: "Z1-Z2",
    description: "",
    minEffectiveMins: 30,
    blockIdx: 0,
  }) as unknown as ScheduledWorkout;

describe("dayShape", () => {
  it("scales height against the week's longest day", () => {
    const day = slot({ workouts: [w(60, "aerobic_base")] });
    expect(dayShape(day, 120).heightPct).toBe(50);
  });

  it("sums a day that holds more than one session", () => {
    const day = slot({ workouts: [w(45, "aerobic_base"), w(30, "recovery")] });
    expect(dayShape(day, 150).mins).toBe(75);
  });

  // A 20-minute recovery spin and an empty day must not look alike. The bar
  // never falls below a floor, and a rest day is not a short bar at all.
  it("floors a very short session instead of rendering a hairline", () => {
    const day = slot({ workouts: [w(20, "recovery")] });
    expect(dayShape(day, 300).heightPct).toBeGreaterThanOrEqual(12);
  });

  it("calls a day with no sessions rest, not a zero-height bar", () => {
    expect(dayShape(slot(), 120).rest).toBe(true);
    expect(dayShape(slot({ workouts: [w(60, "long")] }), 120).rest).toBe(false);
  });

  // Intensity is read from the engine's own purpose taxonomy, never by
  // parsing the "Z4-Z5" display string.
  it("marks threshold and vo2max days hard, and nothing else", () => {
    expect(dayShape(slot({ workouts: [w(60, "threshold")] }), 60).hard).toBe(
      true
    );
    expect(dayShape(slot({ workouts: [w(60, "vo2max")] }), 60).hard).toBe(true);
    expect(dayShape(slot({ workouts: [w(300, "long")] }), 300).hard).toBe(
      false
    );
    expect(dayShape(slot({ workouts: [w(60, "aerobic_base")] }), 60).hard).toBe(
      false
    );
  });

  it("never divides by zero on a week with nothing planned", () => {
    expect(weekMaxMins([slot(), slot()])).toBeGreaterThan(0);
    expect(dayShape(slot(), weekMaxMins([slot()])).heightPct).toBe(0);
  });
});
