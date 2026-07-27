import { describe, expect, it } from "vitest";
import { replanWeek } from "./replan";
import type { WeekState, DaySlot } from "./types";
import type { PlannedWorkout } from "@/lib/training-plan";
import type { AvailabilityBlock } from "@/lib/availability/types";

const blk = (mins: number): AvailabilityBlock => ({
  start: null,
  end: null,
  mins,
  energy: "full",
  sports: null,
});

const w = (o: Partial<PlannedWorkout> = {}): PlannedWorkout => ({
  day: 0,
  sport: "Bike",
  type: "Intervals",
  durationMins: 90,
  intensity: "Z4-Z5",
  description: "5×4min",
  purpose: "vo2max",
  minEffectiveMins: 40,
  ...o,
});

function week(
  spec: { mins: number[]; workouts?: PlannedWorkout[] }[]
): WeekState {
  const days: DaySlot[] = spec.map((s, i) => {
    const availableBlocks = s.mins.map(blk);
    return {
      date: `2026-08-${String(3 + i).padStart(2, "0")}`,
      availableBlocks,
      workouts: s.workouts ?? [],
      availableMins: availableBlocks.reduce((a, b) => a + b.mins, 0),
      status: (s.workouts?.length ?? 0) > 0 ? "planned" : "rest",
    };
  });
  return { weekStart: "2026-08-03", skeletonWeek: 3, days };
}

const resolve = (mins: number[][], start = 3) =>
  new Map(
    mins.map((m, i) => [
      `2026-08-${String(start + i).padStart(2, "0")}`,
      m.map(blk),
    ])
  );

describe("replanWeek — rung 1, move", () => {
  it("moves the displaced session and leaves every other day byte-identical", () => {
    const before = week([
      { mins: [0] },
      {
        mins: [60],
        workouts: [
          w({ type: "Endurance", purpose: "aerobic_base", durationMins: 60 }),
        ],
      },
      { mins: [90], workouts: [w()] }, // Wed: intervals
      { mins: [90] }, // Thu: free, same size
      {
        mins: [60],
        workouts: [
          w({ type: "Endurance", purpose: "aerobic_base", durationMins: 60 }),
        ],
      },
      {
        mins: [180],
        workouts: [w({ type: "Long", purpose: "long", durationMins: 180 })],
      },
      {
        mins: [90],
        workouts: [
          w({ type: "Endurance", purpose: "aerobic_base", durationMins: 90 }),
        ],
      },
    ]);
    const r = replanWeek(
      before,
      resolve([[0], [60], [], [90], [60], [180], [90]])
    );

    expect(r.week.days[2].workouts).toEqual([]);
    expect(r.week.days[3].workouts[0].type).toBe("Intervals");
    expect(r.week.days[3].workouts[0].durationMins).toBe(90);
    // untouched days are identical objects by value
    expect(r.week.days[5]).toEqual(before.days[5]);
    expect(r.week.days[6]).toEqual(before.days[6]);
    expect(r.adjustments[0].action).toBe("moved");
  });
});

describe("replanWeek — rung 2, compress", () => {
  it("shortens within the same purpose when nowhere else fits", () => {
    const before = week([{ mins: [90], workouts: [w()] }]);
    const r = replanWeek(before, resolve([[60]]));
    const out = r.week.days[0].workouts[0];
    expect(out.purpose).toBe("vo2max");
    expect(out.durationMins).toBe(60);
    expect(r.adjustments[0].action).toBe("scaled");
  });
});

describe("replanWeek — rung 3, substitute", () => {
  it("swaps purpose when the block is below the session's floor", () => {
    const before = week([{ mins: [90], workouts: [w()] }]);
    const r = replanWeek(before, resolve([[30]])); // vo2max floor is 40
    const out = r.week.days[0].workouts[0];
    expect(out.purpose).toBe("recovery"); // vo2max→threshold(45)→aerobic(40)→recovery(20)
    expect(out.durationMins).toBe(30);
    expect(r.adjustments[0].action).toBe("swapped");
  });
});

describe("replanWeek — rung 4, drop", () => {
  it("drops the session when the day goes to zero and nothing else fits", () => {
    const before = week([{ mins: [90], workouts: [w()] }]);
    const r = replanWeek(before, resolve([[]]));
    expect(r.week.days[0].workouts).toEqual([]);
    expect(r.adjustments[0].action).toBe("dropped");
  });
});

describe("replanWeek — look-ahead", () => {
  // The JOIN failure this design exists to avoid: never move a session onto
  // a day the athlete has already said they cannot train.
  it("compresses rather than moving onto a day with no room", () => {
    const before = week([
      { mins: [90], workouts: [w()] },
      { mins: [0] },
      { mins: [0] },
    ]);
    const r = replanWeek(before, resolve([[60], [], []]));
    expect(r.week.days[0].workouts[0].durationMins).toBe(60);
    expect(r.week.days[1].workouts).toEqual([]);
    expect(r.week.days[2].workouts).toEqual([]);
  });
});

describe("replanWeek — locked days", () => {
  it("never touches a completed or missed day", () => {
    const done = week([{ mins: [90], workouts: [w()] }]);
    done.days[0].status = "completed";
    const r = replanWeek(done, resolve([[]]));
    expect(r.week.days[0].workouts.length).toBe(1);
    expect(r.adjustments).toEqual([]);
  });
});

describe("replanWeek — stability", () => {
  it("is a no-op when availability is unchanged", () => {
    const before = week([{ mins: [90], workouts: [w()] }]);
    const r = replanWeek(before, resolve([[90]]));
    expect(r.week.days).toEqual(before.days);
    expect(r.adjustments).toEqual([]);
  });
});

describe("replanWeek — fitted placements are validated with admits, not energy alone", () => {
  // Regression for the defect just fixed in materializeWeek's fallback path:
  // a fitted (compressed/substituted) session still needs to respect the
  // no-two-quality-sessions-adjacent rule, not just the energy ceiling.
  //
  // Day 0 (vo2max/Intervals, 60min) loses all its availability and must
  // move whole; the only day roomy enough is Day 1, which is empty before
  // this replan, so the move is legal and Day 1 becomes quality.
  //
  // Day 2 (Tempo/threshold, 90min) shrinks to 50min — arithmetically a
  // legal compress (threshold floors at 45) — but Day 2 is adjacent to
  // Day 1, which by the time Day 2 is processed already holds the session
  // moved in from Day 0. A compress that skipped admits() (checking only
  // energy, as materializeWeek's old fallback did) would happily place a
  // second quality session next to it. With the real admission rule, the
  // compress is rejected, and — since Day 2 has only the one block, so
  // there is no other candidate to fall back to — the session is dropped
  // rather than left in an invalid state.
  it("rejects a compress that would land a fitted session next to another quality session, and drops it", () => {
    const before = week([
      {
        mins: [60],
        workouts: [
          w({ type: "Intervals", purpose: "vo2max", durationMins: 60 }),
        ],
      }, // Day 0
      { mins: [0] }, // Day 1: empty, gains room this week
      {
        mins: [90],
        workouts: [
          w({ type: "Tempo", purpose: "threshold", durationMins: 90 }),
        ],
      }, // Day 2
    ]);
    const r = replanWeek(before, resolve([[0], [60], [50]]));

    // Day 0's session had nowhere to compress to at home (room 0) but Day 1
    // admits it whole, so it moves there — becoming Day 1's quality session.
    expect(r.week.days[0].workouts).toEqual([]);
    expect(r.week.days[1].workouts.length).toBe(1);
    expect(r.week.days[1].workouts[0].type).toBe("Intervals");
    expect(r.week.days[1].workouts[0].durationMins).toBe(60);

    // Day 2's compress is arithmetically legal (50 >= threshold floor 45)
    // but adjacent to Day 1's now-quality session, so it must be rejected
    // and the session dropped rather than silently placed.
    expect(r.week.days[2].workouts).toEqual([]);

    expect(r.adjustments.find((a) => a.date === "2026-08-03")?.action).toBe(
      "moved"
    );
    expect(r.adjustments.find((a) => a.date === "2026-08-05")?.action).toBe(
      "dropped"
    );

    // No two quality sessions end up adjacent anywhere in the result.
    const QUALITY = ["Intervals", "Tempo", "Brick"];
    for (let i = 1; i < r.week.days.length; i++) {
      const prevQuality = r.week.days[i - 1].workouts.some((x) =>
        QUALITY.includes(x.type)
      );
      const dayQuality = r.week.days[i].workouts.some((x) =>
        QUALITY.includes(x.type)
      );
      expect(prevQuality && dayQuality).toBe(false);
    }
  });
});
