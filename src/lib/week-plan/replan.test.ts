import { describe, expect, it } from "vitest";
import { replanWeek } from "./replan";
import { blockMins } from "@/lib/availability/types";
import type { WeekState, DaySlot, ScheduledWorkout } from "./types";
import type { AvailabilityBlock } from "@/lib/availability/types";

const blk = (mins: number): AvailabilityBlock => ({
  start: null,
  end: null,
  mins,
  energy: "full",
  sports: null,
});

const w = (o: Partial<ScheduledWorkout> = {}): ScheduledWorkout => ({
  day: 0,
  sport: "Bike",
  type: "Intervals",
  durationMins: 90,
  intensity: "Z4-Z5",
  description: "5×4min",
  purpose: "vo2max",
  minEffectiveMins: 40,
  blockIdx: 0,
  ...o,
});

function week(
  spec: { mins: number[]; workouts?: ScheduledWorkout[] }[]
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

/**
 * Like `week`, but each day is given kept sessions already sitting in a
 * named block — the shape a replan actually receives, once a day can hold
 * more than one. Reuses `w`'s defaults so only what the test cares about
 * (blockIdx, duration, type, purpose) needs to be spelled out.
 */
function weekWithKept(
  spec: { mins: number[]; kept?: Partial<ScheduledWorkout>[] }[]
): WeekState {
  const days: DaySlot[] = spec.map((s, i) => {
    const availableBlocks = s.mins.map(blk);
    const workouts = (s.kept ?? []).map((k) => w(k));
    return {
      date: `2026-08-${String(3 + i).padStart(2, "0")}`,
      availableBlocks,
      workouts,
      availableMins: availableBlocks.reduce((a, b) => a + b.mins, 0),
      status: workouts.length > 0 ? "planned" : "rest",
    };
  });
  return { weekStart: "2026-08-03", skeletonWeek: 3, days };
}

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

describe("replanWeek — multi-block days", () => {
  it("never moves a session into a block a kept session already occupies", () => {
    // Day 0: one 90min block, already holding a kept 80min Endurance session.
    // Day 1: an 85min Intervals session whose availability drops to zero.
    // The Intervals session must NOT land in day 0's single, occupied block.
    // It has nowhere whole to go, so it must compress, substitute or drop —
    // anything except double-booking the block.
    const before = weekWithKept([
      {
        mins: [90],
        kept: [
          {
            blockIdx: 0,
            durationMins: 80,
            type: "Endurance",
            purpose: "aerobic_base",
          },
        ],
      },
      {
        mins: [85],
        kept: [
          {
            blockIdx: 0,
            durationMins: 85,
            type: "Intervals",
            purpose: "vo2max",
          },
        ],
      },
    ]);
    const r = replanWeek(before, resolve([[90], []]));

    const day0 = r.week.days[0];
    const used = day0.workouts.map((w) => w.blockIdx);
    expect(new Set(used).size).toBe(used.length); // no block claimed twice
    const totalOnDay0 = day0.workouts.reduce((s, w) => s + w.durationMins, 0);
    expect(totalOnDay0).toBeLessThanOrEqual(90);
  });

  it("displaces a session whose own block shrank, even when a bigger block on that day is untouched", () => {
    // Day 0 has two blocks: 90min (kept 85min ride) and 30min (kept 25min
    // recovery). The small block shrinks to 5min. The recovery session no
    // longer fits ITS block and must be adjusted — the untouched 90min block
    // must not excuse it.
    const before = weekWithKept([
      {
        mins: [90, 30],
        kept: [
          {
            blockIdx: 0,
            durationMins: 85,
            type: "Endurance",
            purpose: "aerobic_base",
          },
          {
            blockIdx: 1,
            durationMins: 25,
            type: "Recovery",
            purpose: "recovery",
          },
        ],
      },
    ]);
    const r = replanWeek(before, resolve([[90, 5]]));

    expect(r.adjustments.length).toBeGreaterThan(0);
    const survivors = r.week.days[0].workouts;
    for (const w of survivors) {
      const block = r.week.days[0].availableBlocks[w.blockIdx];
      expect(w.durationMins).toBeLessThanOrEqual(blockMins(block));
    }
  });

  it("still reports no-op on unchanged availability with multiple blocks", () => {
    const before = weekWithKept([
      {
        mins: [90, 30],
        kept: [
          {
            blockIdx: 0,
            durationMins: 85,
            type: "Endurance",
            purpose: "aerobic_base",
          },
          {
            blockIdx: 1,
            durationMins: 25,
            type: "Recovery",
            purpose: "recovery",
          },
        ],
      },
    ]);
    const r = replanWeek(before, resolve([[90, 30]]));
    expect(r.week.days).toEqual(before.days);
    expect(r.adjustments).toEqual([]);
  });

  it("relocates a displaced session to a free sibling block on its own day, whole and undegraded", () => {
    // Day 0 has two blocks: 30min (holding a kept 25min Recovery session in
    // block 0) and 90min (block 1, completely free). Block 0 shrinks to
    // 5min, displacing the recovery session — but the untouched 90min
    // sibling block on the SAME day fits it whole. It must relocate there,
    // not be dropped: a free block on the session's own day is exactly as
    // legitimate a rung-1 target as one on any other day.
    const before = weekWithKept([
      {
        mins: [30, 90],
        kept: [
          {
            blockIdx: 0,
            durationMins: 25,
            type: "Recovery",
            purpose: "recovery",
          },
        ],
      },
    ]);
    const r = replanWeek(before, resolve([[5, 90]]));

    const survivors = r.week.days[0].workouts;
    const recovery = survivors.find((s) => s.type === "Recovery");
    expect(recovery).toBeDefined();
    expect(recovery!.durationMins).toBe(25);
    expect(recovery!.purpose).toBe("recovery");
    const block = r.week.days[0].availableBlocks[recovery!.blockIdx];
    expect(recovery!.durationMins).toBeLessThanOrEqual(blockMins(block));

    expect(
      r.adjustments.some(
        (a) => a.date === "2026-08-03" && a.action === "dropped"
      )
    ).toBe(false);
  });

  it("keeps the no-op guarantee now that rung 1 can target the session's own day", () => {
    const before = weekWithKept([
      {
        mins: [30, 90],
        kept: [
          {
            blockIdx: 0,
            durationMins: 25,
            type: "Recovery",
            purpose: "recovery",
          },
        ],
      },
    ]);
    const r = replanWeek(before, resolve([[30, 90]]));
    expect(r.week.days).toEqual(before.days);
    expect(r.adjustments).toEqual([]);
  });
});
