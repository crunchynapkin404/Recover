import { describe, expect, it } from "vitest";
import { fuellingSummary } from "./summary";
import type { ScheduledWorkout } from "@/lib/week-plan/types";
import { blockPlacement } from "@/lib/week-plan/placement";

// A genuine ScheduledWorkout, not a cast past the type system. The brief's
// original fixture built `{ type, durationMins } as ScheduledWorkout` —
// `fuellingSummary` hands each session straight to `fuellingFromSession`,
// which reads `durationMins`, `intensity`, and `type` (from-session.ts:6-8),
// so a fixture missing `intensity` was never exercising the real function;
// it was exercising `intensity: undefined` and getting away with it only
// because the cast hid the gap. Every field below is real, so this fixture
// satisfies `ScheduledWorkout` on its own — no cast required.
const ride = (durationMins: number): ScheduledWorkout => ({
  day: 3,
  sport: "Ride",
  type: "Endurance",
  durationMins,
  intensity: "Z1-Z2",
  description: "",
  purpose: "aerobic_base",
  minEffectiveMins: 30,
  placement: blockPlacement(0),
});

describe("fuellingSummary", () => {
  it("is null with no sessions — the line does not render at all", () => {
    expect(fuellingSummary([], 70)).toBeNull();
  });

  it("names the before-figure for a single session", () => {
    const line = fuellingSummary([ride(90)], 70);
    expect(line).toMatch(/^Fuelling: \d+-\d+ g carbs before$/);
  });

  it("counts rather than picking a winner when a day has two sessions", () => {
    // Two sessions have two different before-figures (60 min lands in the
    // "short" band, 20-30g; 120 min lands in "medium", 30-50g — see
    // BEFORE_CARBS_G in fuelling-constants.ts). Showing one silently would
    // attach a number to the wrong session — the day holds up to two.
    expect(fuellingSummary([ride(60), ride(120)], 70)).toBe(
      "Fuelling: 2 sessions"
    );
  });

  it("still answers without a body mass", () => {
    expect(fuellingSummary([ride(90)], null)).not.toBeNull();
  });
});
