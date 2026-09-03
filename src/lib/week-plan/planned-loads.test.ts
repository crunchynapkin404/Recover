import { describe, expect, it } from "vitest";
import { openWeekPlannedLoads } from "./planned-loads";
import type { DaySlot, ScheduledWorkout } from "./types";
import { blockPlacement } from "./placement";

const w = (mins: number): ScheduledWorkout => ({
  day: 0,
  sport: "Bike",
  type: "Endurance",
  durationMins: mins,
  intensity: "Z1-Z2",
  description: "Aerobic endurance ride",
  purpose: "aerobic_base",
  minEffectiveMins: 40,
  placement: blockPlacement(0),
});

const strengthWorkout = (mins: number): ScheduledWorkout => ({
  day: 0,
  sport: "Strength",
  type: "Strength",
  durationMins: mins,
  intensity: "4x8",
  description: "Squat 4x8 · Bench 4x8",
  purpose: "strength",
  minEffectiveMins: 20,
  placement: blockPlacement(1),
});

function day(date: string, status: DaySlot["status"], mins: number[]): DaySlot {
  return {
    date,
    availableBlocks: [],
    workouts: mins.map(w),
    availableMins: 0,
    status,
  };
}

// Monday already done, Wednesday and Friday still to come. 800 materialized
// minutes at 400 load = 0.5 load per minute.
const PER_MIN = 0.5;
const week = [
  day("2026-08-03", "completed", [100]),
  day("2026-08-05", "planned", [100]),
  day("2026-08-07", "planned", [300]),
];

describe("openWeekPlannedLoads", () => {
  it("projects each future day from the rate alone", () => {
    const r = openWeekPlannedLoads({
      days: week,
      perMin: PER_MIN,
      fallbackTarget: 400,
      today: "2026-08-04",
    });

    expect(r).toEqual([
      { date: "2026-08-05", load: 50 },
      { date: "2026-08-07", load: 150 },
    ]);
  });

  it("does not lower another day when a session is added", () => {
    // The defect. The completed Monday matters: with the old
    // target-over-remaining-minutes formula, Wednesday fell when Saturday
    // appeared. The rate does not move, so Wednesday must not either.
    const grown = [...week, day("2026-08-08", "planned", [150])];

    const before = openWeekPlannedLoads({
      days: week,
      perMin: PER_MIN,
      fallbackTarget: 400,
      today: "2026-08-04",
    });
    const after = openWeekPlannedLoads({
      days: grown,
      perMin: PER_MIN,
      fallbackTarget: 400,
      today: "2026-08-04",
    });

    const wed = (rows: { date: string; load: number }[]) =>
      rows.find((x) => x.date === "2026-08-05")!.load;

    expect(wed(after)).toBe(wed(before));
    expect(after).toContainEqual({ date: "2026-08-08", load: 75 });
  });

  it("skips days that have already happened", () => {
    const r = openWeekPlannedLoads({
      days: week,
      perMin: PER_MIN,
      fallbackTarget: 400,
      today: "2026-08-06",
    });

    expect(r.map((x) => x.date)).toEqual(["2026-08-07"]);
  });

  it("falls back to spreading the target when the rate is unknown", () => {
    // Pre-migration rows keep today's exact behaviour: 400 spread across the
    // 400 remaining planned minutes, so Wednesday's 100min carries 100.
    const r = openWeekPlannedLoads({
      days: week,
      perMin: null,
      fallbackTarget: 400,
      today: "2026-08-04",
    });

    expect(r).toEqual([
      { date: "2026-08-05", load: 100 },
      { date: "2026-08-07", load: 300 },
    ]);
  });

  it("counts a forecastable day already in the past toward the fallback divisor", () => {
    // The blind spot the case above cannot see: in `week`, Monday is
    // "completed", so it is not forecastable and the divisor (all
    // forecastable days) happens to equal `future` (the two days after
    // today) by coincidence, not by construction. Swapping the divisor for
    // `future` alone would still pass every other test in this file.
    //
    // Here Monday is "planned" instead — never completed, still forecastable
    // even though it is now in the past — so it must still count toward the
    // total even though it is not itself projected.
    const weekWithPastPlanned = [
      day("2026-08-03", "planned", [100]),
      day("2026-08-05", "planned", [100]),
      day("2026-08-07", "planned", [300]),
    ];

    const r = openWeekPlannedLoads({
      days: weekWithPastPlanned,
      perMin: null,
      fallbackTarget: 400,
      today: "2026-08-04",
    });

    // Forecastable total is 500 (all three days), not 400 (the two future
    // days alone): 400 × (100/500) = 80, 400 × (300/500) = 240.
    expect(r).toEqual([
      { date: "2026-08-05", load: 80 },
      { date: "2026-08-07", load: 240 },
    ]);
  });

  it("projects nothing from a week with no future sessions", () => {
    expect(
      openWeekPlannedLoads({
        days: [day("2026-08-03", "completed", [100])],
        perMin: PER_MIN,
        fallbackTarget: 400,
        today: "2026-08-04",
      })
    ).toEqual([]);
  });

  it("FIX 2: does not book the endurance load rate onto a lift's minutes", () => {
    // A day carrying 300 endurance minutes plus a 45min lift. `perMin` is an
    // ENDURANCE-only rate (materialized_mins excludes strength, per Task 7);
    // if strength minutes leaked into this day's total, the rate would be
    // applied to the lift's 45 minutes too, inflating the race forecast's
    // CTL/ATL/TSB and outlook band with load a lift never produces.
    const mixedDay: DaySlot = {
      date: "2026-08-07",
      availableBlocks: [],
      workouts: [w(300), strengthWorkout(45)],
      availableMins: 0,
      status: "planned",
    };
    const r = openWeekPlannedLoads({
      days: [day("2026-08-03", "completed", [100]), mixedDay],
      perMin: PER_MIN,
      fallbackTarget: 400,
      today: "2026-08-04",
    });

    // 300 endurance minutes x 0.5/min = 150. Were the 45 strength minutes
    // counted too, this would read 172.5.
    expect(r).toEqual([{ date: "2026-08-07", load: 150 }]);
  });
});
