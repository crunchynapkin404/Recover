import { describe, expect, it } from "vitest";
import { buildSlots, admits, slotKey, fitToBlock } from "./slots";
import type { DaySlot, ScheduledWorkout } from "./types";
import { PURPOSE_FLOORS, type Energy } from "@/lib/availability/types";

function day(
  date: string,
  blocks: { mins: number; energy?: Energy; sports?: string[] | null }[],
  workouts: ScheduledWorkout[] = []
): DaySlot {
  const availableBlocks = blocks.map((b) => ({
    start: null,
    end: null,
    mins: b.mins,
    energy: b.energy ?? ("full" as Energy),
    sports: b.sports ?? null,
  }));
  return {
    date,
    availableBlocks,
    workouts,
    availableMins: availableBlocks.reduce((s, b) => s + b.mins, 0),
    status: workouts.length > 0 ? "planned" : "rest",
  };
}

const workout = (o: Partial<ScheduledWorkout> = {}): ScheduledWorkout => ({
  day: 0,
  sport: "Bike",
  type: "Intervals",
  durationMins: 60,
  intensity: "Z4-Z5",
  description: "intervals",
  purpose: "vo2max",
  minEffectiveMins: 40,
  blockIdx: 0,
  ...o,
});

const week = (days: DaySlot[]) => days;

describe("buildSlots", () => {
  it("emits one slot per block, roomiest first, then by day then block", () => {
    const days = week([
      day("2026-08-03", [{ mins: 45 }, { mins: 60 }]),
      day("2026-08-04", [{ mins: 180 }]),
      day("2026-08-05", []),
    ]);
    expect(buildSlots(days).map((s) => [s.dayIdx, s.blockIdx, s.mins])).toEqual(
      [
        [1, 0, 180],
        [0, 1, 60],
        [0, 0, 45],
      ]
    );
  });

  it("emits nothing for a day with no blocks", () => {
    expect(buildSlots(week([day("2026-08-03", [])]))).toEqual([]);
  });

  it("breaks a genuine tie by day index, then block index", () => {
    const days = week([
      day("2026-08-03", [{ mins: 60 }, { mins: 60 }]),
      day("2026-08-04", []),
      day("2026-08-05", [{ mins: 60 }]),
    ]);
    expect(buildSlots(days).map((s) => [s.dayIdx, s.blockIdx, s.mins])).toEqual(
      [
        [0, 0, 60],
        [0, 1, 60],
        [2, 0, 60],
      ]
    );
  });
});

describe("admits", () => {
  const empty = new Set<string>();

  it("refuses a session longer than the block", () => {
    const days = week([day("2026-08-03", [{ mins: 45 }])]);
    expect(
      admits(buildSlots(days)[0], workout({ durationMins: 60 }), days, empty)
    ).toBe(false);
  });

  it("refuses a session the block's sport list excludes", () => {
    const days = week([day("2026-08-03", [{ mins: 90, sports: ["Run"] }])]);
    expect(
      admits(buildSlots(days)[0], workout({ sport: "Bike" }), days, empty)
    ).toBe(false);
  });

  it("admits any sport when the block names none", () => {
    const days = week([day("2026-08-03", [{ mins: 90, sports: null }])]);
    expect(
      admits(buildSlots(days)[0], workout({ sport: "Bike" }), days, empty)
    ).toBe(true);
  });

  it("refuses vo2max in an easy block", () => {
    const days = week([day("2026-08-03", [{ mins: 90, energy: "easy" }])]);
    expect(
      admits(buildSlots(days)[0], workout({ purpose: "vo2max" }), days, empty)
    ).toBe(false);
  });

  it("admits threshold in a normal block but not vo2max", () => {
    const days = week([day("2026-08-03", [{ mins: 90, energy: "normal" }])]);
    const s = buildSlots(days)[0];
    expect(
      admits(s, workout({ purpose: "threshold", type: "Tempo" }), days, empty)
    ).toBe(true);
    expect(admits(s, workout({ purpose: "vo2max" }), days, empty)).toBe(false);
  });

  it("refuses a quality session next to another quality day", () => {
    const days = week([
      day("2026-08-03", [{ mins: 90 }], [workout({ type: "Intervals" })]),
      day("2026-08-04", [{ mins: 90 }]),
    ]);
    const target = buildSlots(days).find((s) => s.dayIdx === 1)!;
    expect(admits(target, workout({ type: "Intervals" }), days, empty)).toBe(
      false
    );
  });

  it("refuses a third session on a day that already has two", () => {
    const days = week([
      day(
        "2026-08-03",
        [{ mins: 60 }, { mins: 60 }, { mins: 60 }],
        [
          workout({ type: "Endurance", purpose: "aerobic_base", blockIdx: 0 }),
          workout({ type: "Endurance", purpose: "aerobic_base", blockIdx: 1 }),
        ]
      ),
    ]);
    const third = buildSlots(days)[2];
    expect(
      admits(
        third,
        workout({ type: "Endurance", purpose: "aerobic_base" }),
        days,
        empty
      )
    ).toBe(false);
  });

  it("refuses a slot already taken in this pass", () => {
    const days = week([day("2026-08-03", [{ mins: 90 }])]);
    const s = buildSlots(days)[0];
    expect(admits(s, workout(), days, new Set([slotKey(s)]))).toBe(false);
  });
});

describe("fitToBlock", () => {
  it("keeps the session whole when the room allows it", () => {
    const r = fitToBlock(workout({ durationMins: 60 }), 90)!;
    expect(r.how).toBe("whole");
    expect(r.workout.durationMins).toBe(60);
  });

  it("compresses within the same purpose down to the floor", () => {
    const r = fitToBlock(workout({ durationMins: 90 }), 60)!; // vo2max floor 40
    expect(r.how).toBe("compressed");
    expect(r.workout.purpose).toBe("vo2max");
    expect(r.workout.durationMins).toBe(60);
  });

  it("substitutes when the room is below the session's floor", () => {
    const r = fitToBlock(workout({ durationMins: 90 }), 30)!; // below vo2max's 40
    expect(r.how).toBe("substituted");
    expect(r.workout.purpose).toBe("recovery");
    expect(r.workout.durationMins).toBe(30);
  });

  it("steps a long ride down to aerobic base", () => {
    const r = fitToBlock(
      workout({ type: "Long", purpose: "long", durationMins: 180 }),
      60
    )!; // long floor 90, aerobic_base floor 40
    expect(r.how).toBe("substituted");
    expect(r.workout.purpose).toBe("aerobic_base");
    expect(r.workout.durationMins).toBe(60);
  });

  it("returns null when there is no room at all", () => {
    expect(fitToBlock(workout(), 0)).toBeNull();
  });

  it("returns null when even recovery does not fit", () => {
    expect(fitToBlock(workout(), 15)).toBeNull(); // recovery floor is 20
  });

  it("compresses to exactly the floor without substituting", () => {
    const floor = PURPOSE_FLOORS.threshold;
    const r = fitToBlock(
      workout({ type: "Tempo", purpose: "threshold", durationMins: 90 }),
      floor
    )!;
    expect(r.how).toBe("compressed");
    expect(r.workout.purpose).toBe("threshold");
    expect(r.workout.durationMins).toBe(floor);
  });

  it("returns null instead of a negative-duration workout when room is negative", () => {
    expect(fitToBlock(workout(), -10)).toBeNull();
  });
});
