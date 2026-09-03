import { describe, it, expect } from "vitest";
import { recommendContextFor } from "./picker-context";
import type { DaySlot } from "@/lib/week-plan/types";
import { athletePlacement, blockPlacement } from "@/lib/week-plan/placement";
import { withPurpose } from "@/lib/training-plan";
import { LIBRARY } from "./library";

const PICK = LIBRARY[0];

const day = (date: string, workouts: DaySlot["workouts"] = []): DaySlot => ({
  date,
  availableBlocks: [],
  workouts,
  availableMins: 0,
  status: workouts.length ? "planned" : "rest",
});

const quality = withPurpose({
  day: 0,
  sport: "Bike",
  type: "Intervals",
  durationMins: 60,
  intensity: "Z4-Z5",
  description: "",
  placement: blockPlacement(0),
});

const chosen = withPurpose({
  day: 0,
  sport: "Bike",
  type: "Endurance",
  durationMins: 60,
  intensity: "Z1-Z2",
  description: "",
  placement: athletePlacement({
    workoutId: PICK.id,
    chosenAt: "2026-09-01T00:00:00.000Z",
  }),
});

const DATES = ["2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10"];

describe("recommendContextFor", () => {
  it("counts days back to the nearest quality session", () => {
    const days = [day(DATES[0], [quality]), day(DATES[1]), day(DATES[2])];
    expect(
      recommendContextFor(days, DATES[2], "green", null).daysSinceQuality
    ).toBe(2);
  });

  it("reads as long-since when the week holds no quality at all", () => {
    // Otherwise a first-ever pick could never be a hard session.
    const days = DATES.map((d) => day(d));
    expect(
      recommendContextFor(days, DATES[2], "green", null).daysSinceQuality
    ).toBeGreaterThan(7);
  });

  it("computes the week's planned fraction of its target", () => {
    const days = [day(DATES[0], [quality]), day(DATES[1], [quality])];
    expect(
      recommendContextFor(days, DATES[1], "green", 240).weekLoadFraction
    ).toBe(0.5);
  });

  it("treats an unknown target as 0, never as over-target", () => {
    // An unknown ceiling must not silently demote every hard session.
    const days = [day(DATES[0], [quality])];
    expect(
      recommendContextFor(days, DATES[0], "green", null).weekLoadFraction
    ).toBe(0);
  });

  it("collects families from the athlete's own recent picks", () => {
    const days = [day(DATES[0], [chosen]), day(DATES[1])];
    expect(
      recommendContextFor(days, DATES[1], "green", null).recentFamilies
    ).toEqual([PICK.family]);
  });

  it("ignores engine-placed sessions when collecting families", () => {
    // Their workout is derived on read from a date seed, so there is no
    // stored id to read a family from — guessing one would be inventing it.
    const days = [day(DATES[0], [quality]), day(DATES[1])];
    expect(
      recommendContextFor(days, DATES[1], "green", null).recentFamilies
    ).toEqual([]);
  });

  it("does not look forward for families", () => {
    const days = [day(DATES[0]), day(DATES[1], [chosen])];
    expect(
      recommendContextFor(days, DATES[0], "green", null).recentFamilies
    ).toEqual([]);
  });
});
