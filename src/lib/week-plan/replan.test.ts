import { describe, expect, it } from "vitest";
import { replanWeek } from "./replan";
import { blockMins } from "@/lib/availability/types";
import type { WeekState, DaySlot, ScheduledWorkout } from "./types";
import type { AvailabilityBlock } from "@/lib/availability/types";
import { blockPlacement } from "./placement";
import { blockIdxOf } from "./placement";

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
  placement: blockPlacement(0),
  ...o,
});

// Every fixture week starts here; using it as "today" keeps all seven days in
// the present or future, which is what these tests assumed before replanWeek
// learned to refuse past days.
const WEEK_START = "2026-08-03";

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
      resolve([[0], [60], [], [90], [60], [180], [90]]),
      WEEK_START,
      null
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
    const r = replanWeek(before, resolve([[60]]), WEEK_START, null);
    const out = r.week.days[0].workouts[0];
    expect(out.purpose).toBe("vo2max");
    expect(out.durationMins).toBe(60);
    expect(r.adjustments[0].action).toBe("scaled");
  });
});

describe("replanWeek — rung 3, substitute", () => {
  it("swaps purpose when the block is below the session's floor", () => {
    const before = week([{ mins: [90], workouts: [w()] }]);
    const r = replanWeek(before, resolve([[30]]), WEEK_START, null); // vo2max floor is 40
    const out = r.week.days[0].workouts[0];
    expect(out.purpose).toBe("recovery"); // vo2max→threshold(45)→aerobic(40)→recovery(20)
    expect(out.durationMins).toBe(30);
    expect(r.adjustments[0].action).toBe("swapped");
  });
});

describe("replanWeek — rung 4, drop", () => {
  it("drops the session when the day goes to zero and nothing else fits", () => {
    const before = week([{ mins: [90], workouts: [w()] }]);
    const r = replanWeek(before, resolve([[]]), WEEK_START, null);
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
    const r = replanWeek(before, resolve([[60], [], []]), WEEK_START, null);
    expect(r.week.days[0].workouts[0].durationMins).toBe(60);
    expect(r.week.days[1].workouts).toEqual([]);
    expect(r.week.days[2].workouts).toEqual([]);
  });
});

describe("replanWeek — locked days", () => {
  it("never touches a completed or missed day", () => {
    const done = week([{ mins: [90], workouts: [w()] }]);
    done.days[0].status = "completed";
    const r = replanWeek(done, resolve([[]]), WEEK_START, null);
    expect(r.week.days[0].workouts.length).toBe(1);
    expect(r.adjustments).toEqual([]);
  });
});

describe("replanWeek — stability", () => {
  it("is a no-op when availability is unchanged", () => {
    const before = week([{ mins: [90], workouts: [w()] }]);
    const r = replanWeek(before, resolve([[90]]), WEEK_START, null);
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
    const r = replanWeek(before, resolve([[0], [60], [50]]), WEEK_START, null);

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
            placement: blockPlacement(0),
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
            placement: blockPlacement(0),
            durationMins: 85,
            type: "Intervals",
            purpose: "vo2max",
          },
        ],
      },
    ]);
    const r = replanWeek(before, resolve([[90], []]), WEEK_START, null);

    const day0 = r.week.days[0];
    const used = day0.workouts.map((w) => blockIdxOf(w.placement));
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
            placement: blockPlacement(0),
            durationMins: 85,
            type: "Endurance",
            purpose: "aerobic_base",
          },
          {
            placement: blockPlacement(1),
            durationMins: 25,
            type: "Recovery",
            purpose: "recovery",
          },
        ],
      },
    ]);
    const r = replanWeek(before, resolve([[90, 5]]), WEEK_START, null);

    expect(r.adjustments.length).toBeGreaterThan(0);
    const survivors = r.week.days[0].workouts;
    for (const w of survivors) {
      const block = r.week.days[0].availableBlocks[blockIdxOf(w.placement)!];
      expect(w.durationMins).toBeLessThanOrEqual(blockMins(block));
    }
  });

  it("still reports no-op on unchanged availability with multiple blocks", () => {
    const before = weekWithKept([
      {
        mins: [90, 30],
        kept: [
          {
            placement: blockPlacement(0),
            durationMins: 85,
            type: "Endurance",
            purpose: "aerobic_base",
          },
          {
            placement: blockPlacement(1),
            durationMins: 25,
            type: "Recovery",
            purpose: "recovery",
          },
        ],
      },
    ]);
    const r = replanWeek(before, resolve([[90, 30]]), WEEK_START, null);
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
            placement: blockPlacement(0),
            durationMins: 25,
            type: "Recovery",
            purpose: "recovery",
          },
        ],
      },
    ]);
    const r = replanWeek(before, resolve([[5, 90]]), WEEK_START, null);

    const survivors = r.week.days[0].workouts;
    const recovery = survivors.find((s) => s.type === "Recovery");
    expect(recovery).toBeDefined();
    expect(recovery!.durationMins).toBe(25);
    expect(recovery!.purpose).toBe("recovery");
    const block =
      r.week.days[0].availableBlocks[blockIdxOf(recovery!.placement)!];
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
            placement: blockPlacement(0),
            durationMins: 25,
            type: "Recovery",
            purpose: "recovery",
          },
        ],
      },
    ]);
    const r = replanWeek(before, resolve([[30, 90]]), WEEK_START, null);
    expect(r.week.days).toEqual(before.days);
    expect(r.adjustments).toEqual([]);
  });
});

describe("replanWeek — C1: displacement checks admits(), not just size", () => {
  it("displaces a session whose block dropped to an energy tier that no longer admits it, even though size is unchanged", () => {
    const before = week([
      {
        mins: [60],
        workouts: [
          w({ type: "Intervals", purpose: "vo2max", durationMins: 60 }),
        ],
      }, // Mon: 60min block, full energy — unchanged size
      { mins: [60] }, // Tue: free, full energy, admits vo2max
    ]);
    const resolved = new Map([
      [
        "2026-08-03",
        [
          {
            start: null,
            end: null,
            mins: 60,
            energy: "easy" as const,
            sports: null,
          },
        ],
      ],
      [
        "2026-08-04",
        [
          {
            start: null,
            end: null,
            mins: 60,
            energy: "full" as const,
            sports: null,
          },
        ],
      ],
    ]);
    const r = replanWeek(before, resolved, WEEK_START, null);

    // Same size block, only the energy tier dropped — the session must
    // still be recognised as displaced, not left resident on Monday.
    expect(r.week.days[0].workouts).toEqual([]);
    expect(r.week.days[1].workouts[0]?.type).toBe("Intervals");
    expect(r.week.days[1].workouts[0]?.durationMins).toBe(60);
    expect(r.adjustments.length).toBeGreaterThan(0);
    expect(r.adjustments[0].action).toBe("moved");
  });

  it("displaces a session whose block gained a sport restriction that excludes it, even though size and energy are unchanged", () => {
    const before = week([
      {
        mins: [60],
        workouts: [
          w({
            type: "Endurance",
            sport: "Run",
            purpose: "aerobic_base",
            durationMins: 60,
          }),
        ],
      }, // Mon: a Run session
      { mins: [60] }, // Tue: free, any sport
    ]);
    const resolved = new Map([
      [
        "2026-08-03",
        [
          {
            start: null,
            end: null,
            mins: 60,
            energy: "full" as const,
            sports: ["Bike"],
          },
        ],
      ],
      [
        "2026-08-04",
        [
          {
            start: null,
            end: null,
            mins: 60,
            energy: "full" as const,
            sports: null,
          },
        ],
      ],
    ]);
    const r = replanWeek(before, resolved, WEEK_START, null);

    // Same size, same energy — only the sport list narrowed to exclude Run.
    expect(r.week.days[0].workouts).toEqual([]);
    expect(r.week.days[1].workouts[0]?.type).toBe("Endurance");
    expect(r.week.days[1].workouts[0]?.durationMins).toBe(60);
    expect(r.adjustments.length).toBeGreaterThan(0);
    expect(r.adjustments[0].action).toBe("moved");
  });
});

describe("replanWeek — C2: never places a displaced session on a race day", () => {
  it("drops a displaced session rather than moving it onto the week's race day, even when that day is the roomiest candidate", () => {
    const before = week([
      {
        mins: [60],
        workouts: [
          w({ type: "Endurance", purpose: "aerobic_base", durationMins: 60 }),
        ],
      }, // Mon
      {
        mins: [60],
        workouts: [
          w({ type: "Endurance", purpose: "aerobic_base", durationMins: 55 }),
        ],
      }, // Tue — full, no room
      {
        mins: [60],
        workouts: [
          w({ type: "Endurance", purpose: "aerobic_base", durationMins: 55 }),
        ],
      }, // Wed — full, no room
      {
        mins: [60],
        workouts: [
          w({ type: "Endurance", purpose: "aerobic_base", durationMins: 55 }),
        ],
      }, // Thu — full, no room
      {
        mins: [60],
        workouts: [
          w({ type: "Endurance", purpose: "aerobic_base", durationMins: 55 }),
        ],
      }, // Fri — full, no room
      { mins: [300] }, // Sat — race day, roomy
      {
        mins: [60],
        workouts: [
          w({ type: "Endurance", purpose: "aerobic_base", durationMins: 55 }),
        ],
      }, // Sun — full, no room
    ]);
    before.days[5] = {
      ...before.days[5],
      status: "race",
      raceName: "Amsterdam 10k",
    };

    const r = replanWeek(
      before,
      resolve([[], [60], [60], [60], [60], [300], [60]]),
      WEEK_START,
      null
    );

    // The race day must survive completely untouched.
    expect(r.week.days[5].status).toBe("race");
    expect(r.week.days[5].raceName).toBe("Amsterdam 10k");
    expect(r.week.days[5].workouts).toEqual([]);

    // Monday's session has nowhere legal to go (every other day is full,
    // and the only free block is the race day) — it must be dropped, not
    // moved onto the race.
    expect(r.week.days[0].workouts).toEqual([]);
    expect(r.adjustments).toHaveLength(1);
    expect(r.adjustments[0].date).toBe("2026-08-03");
    expect(r.adjustments[0].action).toBe("dropped");
  });
});

describe("replanWeek — Minor: a move must not clobber the target day's own status", () => {
  it("preserves a target day's own status and movedFrom when it already held its own session", () => {
    const before = weekWithKept([
      {
        mins: [60],
        kept: [
          {
            placement: blockPlacement(0),
            durationMins: 55,
            type: "Endurance",
            purpose: "aerobic_base",
          },
        ],
      }, // Mon: displaced (resolves to zero)
      {
        mins: [90, 60],
        kept: [
          {
            placement: blockPlacement(0),
            durationMins: 85,
            type: "Long",
            purpose: "long",
          },
        ],
      }, // Tue: keeps its own Long in block0, free block1 to receive the move
    ]);
    // Every other day of the week is unavailable, so Tuesday's free
    // sibling block is the only legal destination for Monday's session.
    const r = replanWeek(before, resolve([[], [90, 60]]), WEEK_START, null);

    const tuesday = r.week.days[1];
    expect(tuesday.workouts.some((x) => x.type === "Long")).toBe(true);
    expect(tuesday.workouts.some((x) => x.type === "Endurance")).toBe(true);
    // Tuesday's own session didn't move — its day status must not become
    // "moved", and movedFrom must not point at Monday.
    expect(tuesday.status).toBe("planned");
    expect(tuesday.movedFrom).toBeUndefined();
  });
});

// Found by the Task 19 browser walkthrough, not by any unit test: pressing
// "No time today" on a Tuesday moved the session to MONDAY — the day before.
// A past day is not `locked` (a quiet earlier day is just "rest"), it usually
// has the most room left, and the distance sort breaks ties toward the
// EARLIER day, so yesterday beat every future day. The next daily adaptation
// then marked it missed and dissolved it into the remaining sessions: the
// athlete silently lost a session while the log read "moved to <yesterday>,
// which fits it whole".
describe("replanWeek — never moves a session into a day that has passed", () => {
  it("moves forward, not back, when today's availability is zeroed", () => {
    // Wednesday is "today". Monday and Tuesday are in the past and wide open;
    // Thursday is the nearest legal target.
    const before = week([
      { mins: [180] }, // Mon — past, roomy
      { mins: [180] }, // Tue — past, roomy
      { mins: [90], workouts: [w({ day: 2, durationMins: 60 })] }, // Wed
      { mins: [180] }, // Thu — the only legal target
      { mins: [] },
      { mins: [] },
      { mins: [] },
    ]);

    const r = replanWeek(
      before,
      resolve([[180], [180], [], [180], [], [], []]),
      "2026-08-05", // Wednesday
      null
    );

    expect(r.week.days[2].workouts).toEqual([]); // today freed
    expect(r.week.days[0].workouts).toEqual([]); // Monday untouched
    expect(r.week.days[1].workouts).toEqual([]); // Tuesday untouched
    expect(r.week.days[3].workouts).toHaveLength(1); // moved forward
    expect(r.adjustments.some((a) => a.action === "moved")).toBe(true);
  });

  it("drops the session rather than parking it in the past", () => {
    // Same shape, but every FUTURE day is full. The only rooms left are
    // yesterday and the day before, which must not be used.
    const before = week([
      { mins: [180] }, // Mon — past
      { mins: [180] }, // Tue — past
      { mins: [90], workouts: [w({ day: 2, durationMins: 60 })] }, // Wed
      { mins: [] },
      { mins: [] },
      { mins: [] },
      { mins: [] },
    ]);

    const r = replanWeek(
      before,
      resolve([[180], [180], [], [], [], [], []]),
      "2026-08-05",
      null
    );

    expect(r.week.days[2].workouts).toEqual([]);
    expect(r.week.days[0].workouts).toEqual([]);
    expect(r.week.days[1].workouts).toEqual([]);
    expect(r.adjustments.some((a) => a.action === "dropped")).toBe(true);
  });
});

describe("rung 5 — fill", () => {
  it("does nothing at all when fill is null", () => {
    const before = week([{ mins: [180], workouts: [] }, { mins: [180] }]);
    const withFill = week([{ mins: [180], workouts: [] }, { mins: [180] }]);

    const off = replanWeek(before, resolve([[180], [180]]), WEEK_START, null);
    const on = replanWeek(withFill, resolve([[180], [180]]), WEEK_START, {
      targetMins: 600,
      queenStageHours: 4,
      today: WEEK_START,
    });

    // Nothing to fill from (no endurance evidence), so both are identical —
    // this pins that enabling fill is not itself a behaviour change.
    expect(off.week.days).toEqual(on.week.days);
  });

  it("runs after the existing rungs, on their result", () => {
    // Day 0's block shrinks below its session, displacing it to day 1; fill
    // then grows what landed there. Proves ordering: fill sees the moved
    // session, not the original layout.
    //
    // The two worlds are made numerically distinguishable on purpose. If
    // fill ran on the pre-ladder `week.days` instead of the settled `days`,
    // it would see day 0 still holding its original 90min session (nothing
    // ever moved out of it, so day 0's block there is still its original
    // 90min — not the shrunk 30 — and there's no room to grow it: 90 is
    // already the whole block) and day 1 completely empty. Fill would then
    // take the 1b "add one" path on day 1 — bounded by `targetMins -
    // planned` alone (90 already planned on day 0, target 200, so 110min)
    // — producing a brand-new 110min "Long" session, while day 0's
    // original session survives untouched.
    //
    // On the settled days, day 0's session actually moved to day 1 (its own
    // block shrank to 30, admits() rejects it there), so day 0 ends up
    // empty and day 1 holds ONE session — the moved 90min Endurance one —
    // which the 1a "grow in place" path then extends by `durationMins +
    // (targetMins - planned)` = 90 + 110 = 200min, capped by the 300min
    // block and the 300min queen-stage ceiling (neither binds). 200 != 110
    // and "grown Endurance" != "added Long": the two mechanisms cannot
    // coincidentally agree here the way they did with the original
    // same-shaped fixture.
    const start = week([
      {
        mins: [90],
        workouts: [
          w({
            durationMins: 90,
            type: "Endurance",
            purpose: "aerobic_base",
            minEffectiveMins: 40,
          }),
        ],
      },
      { mins: [300] },
    ]);

    const r = replanWeek(start, resolve([[30], [300]]), WEEK_START, {
      targetMins: 200,
      queenStageHours: 5,
      today: WEEK_START,
    });

    // Day 0's session actually left — proves the ladder ran before fill,
    // not that fill happened to also produce an empty day 0.
    expect(r.week.days[0].workouts).toEqual([]);

    // Day 1 holds exactly the moved session, grown — not a second, newly
    // added one.
    expect(r.week.days[1].workouts).toHaveLength(1);
    expect(r.week.days[1].workouts[0].type).toBe("Endurance");
    expect(r.week.days[1].workouts[0].purpose).toBe("aerobic_base");
    expect(r.week.days[1].workouts[0].durationMins).toBe(200);
    expect(r.adjustments.some((a) => a.action === "moved")).toBe(true);
  });

  it("fills the common case too: nothing displaced, but the week is under target", () => {
    // Availability is UNCHANGED (90min block, same as before) so nothing is
    // displaced and replanWeek takes the early `displaced.length === 0`
    // return — the path an athlete who merely added time elsewhere, or
    // whose week was simply never filled to target, takes every time. The
    // session already fits its block (60 of 90min used), and the week
    // (60min planned) sits well under the 600min target, so fill has real
    // room to grow it. If the early return skipped fill, this session would
    // stay at 60 and no "added" adjustment would appear.
    const before = week([
      {
        mins: [90],
        workouts: [
          w({
            durationMins: 60,
            type: "Endurance",
            purpose: "aerobic_base",
            minEffectiveMins: 30,
          }),
        ],
      },
    ]);

    const r = replanWeek(before, resolve([[90]]), WEEK_START, {
      targetMins: 600,
      queenStageHours: 4,
      today: WEEK_START,
    });

    // Grown to fill the (unchanged) 90min block — the block, not the
    // 240min queen-stage ceiling or the 600min target, is what binds here.
    expect(r.week.days[0].workouts).toHaveLength(1);
    expect(r.week.days[0].workouts[0].durationMins).toBe(90);
    expect(r.adjustments.some((a) => a.action === "added")).toBe(true);
  });
});
