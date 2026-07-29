// src/lib/week-plan/adapt-day.test.ts
import { describe, expect, it } from "vitest";
import { adaptDay } from "./adapt-day";
import { AMBER_SCALE, blockFits, dayMins } from "./types";
import type { DaySlot, ScheduledWorkout, WeekState } from "./types";
import { withPurpose } from "@/lib/training-plan";
import { blockMins } from "@/lib/availability/types";

// "full" energy, matching materialize.test.ts's and replan.test.ts's default
// block helpers: a day's ordinary block should admit any session type unless
// a test deliberately narrows it. adaptDay's move sites now route through
// admits() (Task 9b), so an energy tier that can't host a quality session
// would otherwise silently gate tests that were never about energy at all.
function blocksFor(mins: number): DaySlot["availableBlocks"] {
  return mins > 0
    ? [{ start: null, end: null, mins, energy: "full", sports: null }]
    : [];
}

const D = (
  date: string,
  mins: number,
  workout: Partial<ScheduledWorkout> | null,
  status: DaySlot["status"] = workout ? "planned" : "rest"
): DaySlot => {
  const availableBlocks = blocksFor(mins);
  return {
    date,
    availableBlocks,
    availableMins: dayMins({ availableBlocks }),
    workouts: workout
      ? [
          withPurpose({
            day: 0,
            sport: "Run",
            type: "Endurance",
            durationMins: 45,
            intensity: "Z1-Z2",
            description: "Easy run",
            blockIdx: 0,
            ...workout,
          }),
        ]
      : [],
    status,
  };
};

/** Overwrites a day's availability in place (mins only) — keeps
 * availableBlocks/availableMins consistent, the way a real resolved day
 * would. */
function setMins(day: DaySlot, mins: number): void {
  const availableBlocks = blocksFor(mins);
  day.availableBlocks = availableBlocks;
  day.availableMins = dayMins({ availableBlocks });
}

const week = (days: DaySlot[]): WeekState => ({
  weekStart: days[0].date,
  skeletonWeek: 5,
  days,
});

describe("adaptDay — missed yesterday", () => {
  it("marks yesterday missed and moves a quality session forward once", () => {
    const w = week([
      D("2026-07-20", 60, { type: "Intervals", durationMins: 50 }),
      D("2026-07-21", 60, null),
      D("2026-07-22", 90, null),
      D("2026-07-23", 60, null),
      D("2026-07-24", 60, null),
      D("2026-07-25", 60, null),
      D("2026-07-26", 60, null),
    ]);
    const r = adaptDay({
      week: w,
      today: "2026-07-21",
      band: "green",
      yesterdayCompleted: false,
    });
    expect(r.week.days[0].status).toBe("missed");
    const moved = r.week.days.find((d) => d.movedFrom === "2026-07-20");
    expect(moved).toBeDefined();
    expect(moved!.workouts[0]!.type).toBe("Intervals");
    expect(moved!.status).toBe("moved");
    expect(
      r.adjustments.some(
        (a) => a.trigger === "missed_workout" && a.action === "moved"
      )
    ).toBe(true);
  });

  it("missed-yesterday move-forward corrects a carried blockIdx to the block that actually admits it (Task 9b)", () => {
    const w = week([
      D("2026-07-20", 60, { type: "Intervals", durationMins: 50 }),
      D("2026-07-21", 60, { durationMins: 40 }), // today: occupied, not a candidate
      D("2026-07-22", 60, { durationMins: 40 }), // occupied
      D("2026-07-23", 60, { durationMins: 40 }), // occupied
      D("2026-07-24", 60, { durationMins: 40 }), // occupied
      D("2026-07-25", 60, null), // the only free day
      D("2026-07-26", 60, { durationMins: 40 }), // occupied
    ]);
    // The only free day carries two blocks: a 20min block at the carried
    // index (0, from the missed session's own day) and a 120min sibling at
    // index 1. Only the sibling actually fits the 50min session — a naive
    // carry-the-index check would reject this day entirely and drop the
    // session, even though it plainly has room.
    w.days[5] = {
      ...w.days[5],
      availableBlocks: [
        { start: null, end: null, mins: 20, energy: "full", sports: null },
        { start: null, end: null, mins: 120, energy: "full", sports: null },
      ],
    };
    const r = adaptDay({
      week: w,
      today: "2026-07-21",
      band: "green",
      yesterdayCompleted: false,
    });
    const moved = r.week.days.find((d) => d.movedFrom === "2026-07-20");
    expect(moved).toBeDefined();
    expect(moved!.workouts[0]!.blockIdx).toBe(1);
    expect(
      blockFits(
        moved!,
        moved!.workouts[0]!.blockIdx,
        moved!.workouts[0]!.durationMins
      )
    ).toBe(true);
  });

  it("missed-yesterday move-forward never forces a session onto a block that can't hold it — drops it instead (Task 9b)", () => {
    const w = week([
      D("2026-07-20", 60, { type: "Intervals", durationMins: 50 }),
      D("2026-07-21", 20, null),
      D("2026-07-22", 20, null),
      D("2026-07-23", 20, null),
      D("2026-07-24", 20, null),
      D("2026-07-25", 20, null),
      D("2026-07-26", 20, null),
    ]);
    const r = adaptDay({
      week: w,
      today: "2026-07-21",
      band: "green",
      yesterdayCompleted: false,
    });
    expect(r.week.days.some((d) => d.movedFrom === "2026-07-20")).toBe(false);
    expect(
      r.adjustments.some(
        (a) => a.trigger === "missed_workout" && a.action === "dropped"
      )
    ).toBe(true);
  });

  it("drops a quality session missed twice and redistributes capped", () => {
    const w = week([
      D("2026-07-20", 60, null, "missed"),
      D("2026-07-21", 60, { type: "Intervals", durationMins: 48 }, "moved"),
      D("2026-07-22", 60, { durationMins: 40 }),
      D("2026-07-23", 60, { durationMins: 40 }),
      D("2026-07-24", 60, null),
      D("2026-07-25", 60, null),
      D("2026-07-26", 60, null),
    ]);
    w.days[1].movedFrom = "2026-07-20";
    const r = adaptDay({
      week: w,
      today: "2026-07-22",
      band: "green",
      yesterdayCompleted: false,
    });
    expect(r.week.days[1].status).toBe("missed");
    expect(r.week.days.some((d) => d.movedFrom === "2026-07-21")).toBe(false);
    // 40 × 1.25 = 50 max per remaining day
    expect(r.week.days[2].workouts[0]!.durationMins).toBeLessThanOrEqual(50);
    expect(r.week.days[3].workouts[0]!.durationMins).toBeLessThanOrEqual(50);
    expect(
      r.adjustments.some(
        (a) => a.trigger === "missed_workout" && a.action === "dropped"
      )
    ).toBe(true);
  });

  it("never moves a non-quality missed session — drops it", () => {
    const w = week([
      D("2026-07-20", 60, { type: "Endurance", durationMins: 45 }),
      D("2026-07-21", 60, { durationMins: 40 }),
      D("2026-07-22", 90, null),
      D("2026-07-23", 60, null),
      D("2026-07-24", 60, null),
      D("2026-07-25", 60, null),
      D("2026-07-26", 60, null),
    ]);
    const r = adaptDay({
      week: w,
      today: "2026-07-21",
      band: "green",
      yesterdayCompleted: false,
    });
    expect(r.week.days[0].status).toBe("missed");
    expect(r.week.days.some((d) => d.movedFrom)).toBe(false);
  });

  it("drop-and-redistribute caps growth to the occupied block's own capacity, not the day's total across blocks", () => {
    const w = week([
      D("2026-07-20", 60, null, "missed"),
      D("2026-07-21", 60, { type: "Endurance", durationMins: 30 }),
      D("2026-07-22", 60, { durationMins: 20 }),
      D("2026-07-23", 60, null),
      D("2026-07-24", 60, null),
      D("2026-07-25", 60, null),
      D("2026-07-26", 60, null),
    ]);
    // Today's day carries two blocks: the 20min block its own workout
    // occupies (blockIdx 0), and an untouched, much roomier 200min sibling
    // (blockIdx 1). The redistribute cap must be judged against the block
    // the workout actually occupies (20min), never the day's 220min total.
    w.days[2] = {
      ...w.days[2],
      availableBlocks: [
        { start: null, end: null, mins: 20, energy: "normal", sports: null },
        { start: null, end: null, mins: 200, energy: "normal", sports: null },
      ],
    };
    const r = adaptDay({
      week: w,
      today: "2026-07-22",
      band: "green",
      yesterdayCompleted: false,
    });
    const grown = r.week.days[2].workouts[0]!;
    expect(grown.durationMins).toBeLessThanOrEqual(
      blockMins(r.week.days[2].availableBlocks[grown.blockIdx]!)
    );
  });

  it("C3: a missed two-session day accounts for both sessions, not just the first, in the drop/redistribute record", () => {
    const missedDay: DaySlot = {
      date: "2026-07-20",
      availableBlocks: [
        { start: null, end: null, mins: 60, energy: "full", sports: null },
        { start: null, end: null, mins: 120, energy: "full", sports: null },
      ],
      availableMins: 180,
      workouts: [
        withPurpose({
          day: 0,
          sport: "Run",
          type: "Endurance",
          durationMins: 50,
          intensity: "Z1-Z2",
          description: "d",
          blockIdx: 0,
        }),
        withPurpose({
          day: 0,
          sport: "Run",
          type: "Long",
          durationMins: 100,
          intensity: "Z1-Z2",
          description: "d",
          blockIdx: 1,
        }),
      ],
      status: "planned",
    };
    const w = week([
      missedDay,
      D("2026-07-21", 60, { type: "Endurance", durationMins: 40 }),
      D("2026-07-22", 60, { type: "Endurance", durationMins: 40 }),
      D("2026-07-23", 60, null),
      D("2026-07-24", 60, null),
      D("2026-07-25", 60, null),
      D("2026-07-26", 60, null),
    ]);
    const r = adaptDay({
      week: w,
      today: "2026-07-21",
      band: "green",
      yesterdayCompleted: false,
    });
    expect(r.week.days[0].workouts).toEqual([]);
    expect(r.week.days[0].status).toBe("missed");
    const dropped = r.adjustments.find(
      (a) => a.trigger === "missed_workout" && a.action === "dropped"
    );
    expect(dropped).toBeDefined();
    // Both missed sessions must be named — not just the first (Endurance).
    expect(dropped!.reason).toContain("Endurance");
    expect(dropped!.reason).toContain("Long");
    expect(dropped!.before[0].workouts).toHaveLength(2);
    // Both remaining days must have absorbed some of the combined 150min,
    // each capped at +25% of its own original duration (40 → 50 max).
    expect(r.week.days[1].workouts[0]!.durationMins).toBeLessThanOrEqual(50);
    expect(r.week.days[2].workouts[0]!.durationMins).toBeLessThanOrEqual(50);
  });

  it("does nothing on yesterdayCompleted true or null", () => {
    const w = week([
      D("2026-07-20", 60, { durationMins: 45 }, "completed"),
      D("2026-07-21", 60, { durationMins: 40 }),
      D("2026-07-22", 90, null),
      D("2026-07-23", 60, null),
      D("2026-07-24", 60, null),
      D("2026-07-25", 60, null),
      D("2026-07-26", 60, null),
    ]);
    const r = adaptDay({
      week: w,
      today: "2026-07-21",
      band: "green",
      yesterdayCompleted: true,
    });
    expect(r.adjustments).toHaveLength(0);
    expect(r.week).toEqual(w);
  });
});

describe("adaptDay — readiness and availability", () => {
  const base = () =>
    week([
      D("2026-07-20", 60, null, "rest"),
      D("2026-07-21", 60, { type: "Intervals", durationMins: 50 }),
      D("2026-07-22", 90, { durationMins: 60 }),
      D("2026-07-23", 60, null),
      D("2026-07-24", 60, { type: "Tempo", durationMins: 45 }),
      D("2026-07-25", 60, null),
      D("2026-07-26", 120, { type: "Long", durationMins: 110 }),
    ]);

  it("red: intervals become a 30min recovery session, logged", () => {
    const r = adaptDay({
      week: base(),
      today: "2026-07-21",
      band: "red",
      yesterdayCompleted: null,
    });
    const today = r.week.days[1];
    expect(today.workouts[0]!.type).toBe("Recovery");
    expect(today.workouts[0]!.durationMins).toBe(30);
    expect(today.status).toBe("adapted");
    expect(today.workouts[0]!.purpose).toBe("recovery");
    expect(today.workouts[0]!.minEffectiveMins).toBe(20);
    expect(
      r.adjustments.some(
        (a) => a.trigger === "low_readiness" && a.action === "swapped"
      )
    ).toBe(true);
  });

  it("red: endurance is shortened 30%, not swapped", () => {
    const r = adaptDay({
      week: base(),
      today: "2026-07-22",
      band: "red",
      yesterdayCompleted: null,
    });
    expect(r.week.days[2].workouts[0]!.durationMins).toBe(42); // 60 × 0.7
    expect(r.week.days[2].workouts[0]!.type).toBe("Endurance");
  });

  it("amber: intervals step down to tempo at 85% duration", () => {
    const r = adaptDay({
      week: base(),
      today: "2026-07-21",
      band: "amber",
      yesterdayCompleted: null,
    });
    const today = r.week.days[1];
    expect(today.workouts[0]!.type).toBe("Tempo");
    expect(today.workouts[0]!.durationMins).toBe(43); // round(50 × 0.85)
    expect(today.workouts[0]!.purpose).toBe("threshold");
    expect(today.workouts[0]!.minEffectiveMins).toBe(45);
  });

  it("amber: tempo steps down to endurance at 85% duration, purpose follows the new type", () => {
    const r = adaptDay({
      week: base(),
      today: "2026-07-24",
      band: "amber",
      yesterdayCompleted: null,
    });
    const today = r.week.days[4];
    expect(today.workouts[0]!.type).toBe("Endurance");
    expect(today.workouts[0]!.durationMins).toBe(38); // round(45 × 0.85)
    expect(today.workouts[0]!.purpose).toBe("aerobic_base");
    expect(today.workouts[0]!.minEffectiveMins).toBe(40);
  });

  it("calibrating: readiness rules never fire", () => {
    const r = adaptDay({
      week: base(),
      today: "2026-07-21",
      band: "calibrating",
      yesterdayCompleted: null,
    });
    expect(r.week.days[1].workouts[0]!.type).toBe("Intervals");
    expect(
      r.adjustments.filter((a) => a.trigger === "low_readiness")
    ).toHaveLength(0);
  });

  it("green: nothing changes", () => {
    const w = base();
    const r = adaptDay({
      week: w,
      today: "2026-07-21",
      band: "green",
      yesterdayCompleted: null,
    });
    expect(r.week).toEqual(w);
    expect(r.adjustments).toHaveLength(0);
  });

  it("no time today: workout shortens to the available minutes", () => {
    const w = base();
    setMins(w.days[1], 25);
    const r = adaptDay({
      week: w,
      today: "2026-07-21",
      band: "green",
      yesterdayCompleted: null,
    });
    expect(r.week.days[1].workouts[0]!.durationMins).toBe(25);
    expect(r.adjustments.some((a) => a.trigger === "no_time")).toBe(true);
  });

  it("zero time today: workout swaps to a later free day", () => {
    // Own local week rather than base(): base()'s day4 Tempo session is
    // load-bearing for other tests in this block (amber step-down), and
    // reusing it here would put every free day adjacent to a quality
    // session, which is exactly the scenario the next test exists to cover.
    // This week's free days (day3, day5) sit next to non-quality sessions
    // only, so a real admitting block exists and the move should succeed.
    const w = week([
      D("2026-07-20", 60, null, "rest"),
      D("2026-07-21", 60, { type: "Intervals", durationMins: 50 }), // today
      D("2026-07-22", 90, { durationMins: 60 }), // occupied, Endurance
      D("2026-07-23", 60, null), // free — not adjacent to any quality day
      D("2026-07-24", 60, null), // free
      D("2026-07-25", 60, null), // free
      D("2026-07-26", 120, { type: "Long", durationMins: 110 }), // occupied
    ]);
    setMins(w.days[1], 0);
    const r = adaptDay({
      week: w,
      today: "2026-07-21",
      band: "green",
      yesterdayCompleted: null,
    });
    expect(r.week.days[1].workouts).toHaveLength(0);
    expect(r.week.days[1].status).toBe("rest");
    const moved = r.week.days.find((d) => d.movedFrom === "2026-07-21");
    expect(moved?.workouts[0]?.type).toBe("Intervals");
  });

  it("zero time today: drops the session (with a logged reason) when every free day sits next to a quality session", () => {
    // Same shape as base(), but deliberately kept: today's Intervals session
    // has nowhere to go because both remaining free days (day3, day5) are
    // adjacent to day4's Tempo session — admits()'s quality-adjacency rule
    // correctly refuses both, and the drop-and-explain path (pre-existing,
    // unchanged by Task 9b) takes over instead of forcing a bad placement.
    const w = base();
    setMins(w.days[1], 0);
    const r = adaptDay({
      week: w,
      today: "2026-07-21",
      band: "green",
      yesterdayCompleted: null,
    });
    expect(r.week.days[1].workouts).toHaveLength(0);
    expect(r.week.days[1].status).toBe("rest");
    expect(r.week.days.some((d) => d.movedFrom)).toBe(false);
    const dropped = r.adjustments.find(
      (a) => a.trigger === "no_time" && a.action === "dropped"
    );
    expect(dropped).toBeDefined();
    expect(dropped!.reason).toContain("2026-07-21");
    expect(dropped!.reason).toContain("Intervals");
  });

  it("no-time move-forward corrects a carried blockIdx to the block that actually admits it (Task 9b)", () => {
    const w = week([
      D("2026-07-20", 60, null, "rest"),
      D("2026-07-21", 60, { type: "Endurance", durationMins: 45 }), // today
      D("2026-07-22", 60, { durationMins: 40 }), // occupied
      D("2026-07-23", 60, null), // the only free day
      D("2026-07-24", 60, { durationMins: 40 }), // occupied
      D("2026-07-25", 60, { durationMins: 40 }), // occupied
      D("2026-07-26", 60, { durationMins: 40 }), // occupied
    ]);
    setMins(w.days[1], 0);
    // Same shape as the missed-yesterday case: the only free day's fitting
    // block is index 1, not the index (0) the session carries from today.
    w.days[3] = {
      ...w.days[3],
      availableBlocks: [
        { start: null, end: null, mins: 20, energy: "full", sports: null },
        { start: null, end: null, mins: 120, energy: "full", sports: null },
      ],
    };
    const r = adaptDay({
      week: w,
      today: "2026-07-21",
      band: "green",
      yesterdayCompleted: null,
    });
    const moved = r.week.days.find((d) => d.movedFrom === "2026-07-21");
    expect(moved).toBeDefined();
    expect(moved!.workouts[0]!.blockIdx).toBe(1);
    expect(
      blockFits(
        moved!,
        moved!.workouts[0]!.blockIdx,
        moved!.workouts[0]!.durationMins
      )
    ).toBe(true);
  });

  it("no-time move-forward never forces a session onto a block that can't hold it — drops it instead (Task 9b)", () => {
    const w = week([
      D("2026-07-20", 60, null, "rest"),
      D("2026-07-21", 60, { type: "Endurance", durationMins: 45 }),
      D("2026-07-22", 20, null),
      D("2026-07-23", 20, null),
      D("2026-07-24", 20, null),
      D("2026-07-25", 20, null),
      D("2026-07-26", 20, null),
    ]);
    setMins(w.days[1], 0);
    const r = adaptDay({
      week: w,
      today: "2026-07-21",
      band: "green",
      yesterdayCompleted: null,
    });
    expect(r.week.days.some((d) => d.movedFrom === "2026-07-21")).toBe(false);
    expect(
      r.adjustments.some(
        (a) => a.trigger === "no_time" && a.action === "dropped"
      )
    ).toBe(true);
  });

  it("red + no time: availability wins first, then readiness scales", () => {
    const w = base();
    setMins(w.days[2], 30);
    const r = adaptDay({
      week: w,
      today: "2026-07-22",
      band: "red",
      yesterdayCompleted: null,
    });
    // shortened to 30 by availability, then ×0.7 = 21
    expect(r.week.days[2].workouts[0]!.durationMins).toBe(21);
  });

  it("no-time shortening caps duration to the occupied block's own capacity, not the day's total across blocks", () => {
    const w = base();
    // Today carries two blocks: the 20min block its own workout occupies
    // (blockIdx 0) and an untouched, much roomier 200min sibling (blockIdx
    // 1). The shortening must be judged against the block the workout
    // actually occupies (20min), never the day's 220min total.
    w.days[1] = {
      ...w.days[1],
      availableBlocks: [
        { start: null, end: null, mins: 20, energy: "normal", sports: null },
        { start: null, end: null, mins: 200, energy: "normal", sports: null },
      ],
    };
    const r = adaptDay({
      week: w,
      today: "2026-07-21",
      band: "green",
      yesterdayCompleted: null,
    });
    const shortened = r.week.days[1].workouts[0]!;
    expect(shortened.durationMins).toBeLessThanOrEqual(
      blockMins(r.week.days[1].availableBlocks[shortened.blockIdx]!)
    );
  });

  it("C3: a two-session day whose first block collapses to zero keeps the untouched second session, not workouts: []", () => {
    // Exact reproduction from the review: Wednesday has availableBlocks
    // [0min, 120min] and workouts [Endurance@0, Long@1]. Only block 0
    // collapsed; the 100min Long in the untouched 120min block must
    // survive, not vanish along with the affected Endurance session.
    const today: DaySlot = {
      date: "2026-07-22",
      availableBlocks: [
        { start: null, end: null, mins: 0, energy: "full", sports: null },
        { start: null, end: null, mins: 120, energy: "full", sports: null },
      ],
      availableMins: 120,
      workouts: [
        withPurpose({
          day: 2,
          sport: "Run",
          type: "Endurance",
          durationMins: 45,
          intensity: "Z1-Z2",
          description: "d",
          blockIdx: 0,
        }),
        withPurpose({
          day: 2,
          sport: "Run",
          type: "Long",
          durationMins: 100,
          intensity: "Z1-Z2",
          description: "d",
          blockIdx: 1,
        }),
      ],
      status: "planned",
    };
    const w = week([
      D("2026-07-20", 60, null, "rest"),
      D("2026-07-21", 60, null, "rest"),
      today,
      D("2026-07-23", 60, null),
      D("2026-07-24", 60, null),
      D("2026-07-25", 60, null),
      D("2026-07-26", 60, null),
    ]);
    const r = adaptDay({
      week: w,
      today: "2026-07-22",
      band: "green",
      yesterdayCompleted: null,
    });
    const result = r.week.days[2];
    const long = result.workouts.find((x) => x.type === "Long");
    expect(long).toBeDefined();
    expect(long!.durationMins).toBe(100);
    expect(long!.blockIdx).toBe(1);
    expect(result.status).not.toBe("rest");
    // The affected Endurance session is the one accounted for, either
    // moved elsewhere or logged as dropped — never silently gone.
    const enduranceGone = !result.workouts.some((x) => x.type === "Endurance");
    expect(enduranceGone).toBe(true);
    expect(
      r.adjustments.some(
        (a) => a.trigger === "no_time" && a.reason.includes("Endurance")
      )
    ).toBe(true);
  });

  it("I5: a session whose block shrinks below its own purpose floor is fitted, not truncated below the floor", () => {
    // Reproduction from the review: a 90min Intervals (vo2max, floor 40)
    // session whose block shrinks to 20min. The old code set
    // durationMins to 20 directly — below vo2max's own floor and even
    // below every substitute's floor down to threshold/aerobic_base,
    // landing exactly on recovery's floor (20). fitToBlock must route
    // this through the same substitution chain materializeWeek uses.
    const w = week([
      D("2026-07-20", 60, null, "rest"),
      D("2026-07-21", 90, { type: "Intervals", durationMins: 90 }),
      D("2026-07-22", 60, null),
      D("2026-07-23", 60, null),
      D("2026-07-24", 60, null),
      D("2026-07-25", 60, null),
      D("2026-07-26", 60, null),
    ]);
    setMins(w.days[1], 20);
    const r = adaptDay({
      week: w,
      today: "2026-07-21",
      band: "green",
      yesterdayCompleted: null,
    });
    const result = r.week.days[1].workouts[0]!;
    // Never below its own (possibly substituted) purpose floor.
    expect(result.durationMins).toBeGreaterThanOrEqual(result.minEffectiveMins);
    expect(result.durationMins).toBe(20);
    // No longer the untouched-purpose truncation the review flagged.
    expect(result.type).not.toBe("Intervals");
    expect(
      r.adjustments.some(
        (a) => a.trigger === "no_time" && a.action === "swapped"
      )
    ).toBe(true);
  });

  it("a roomy sibling block does not excuse a session in its own shrunk block", () => {
    const w = base();
    // Today now carries two blocks: its own occupied block (blockIdx 0)
    // shrinks to 20min — too small for the 50min Intervals session it
    // holds — while a second, untouched 120min block sits alongside it.
    // Asking "does some block on this day fit?" would wrongly say yes.
    w.days[1] = {
      ...w.days[1],
      availableBlocks: [
        { start: null, end: null, mins: 20, energy: "normal", sports: null },
        { start: null, end: null, mins: 120, energy: "normal", sports: null },
      ],
    };
    const r = adaptDay({
      week: w,
      today: "2026-07-21",
      band: "green",
      yesterdayCompleted: null,
    });
    expect(r.adjustments.some((a) => a.trigger === "no_time")).toBe(true);
    expect(r.week.days[1].status).toBe("adapted");
  });
});

describe("adaptDay — C3: red readiness with no room for a recovery spin", () => {
  it("removes only the affected quality session, keeping an untouched sibling session on the same day", () => {
    const today: DaySlot = {
      date: "2026-07-21",
      availableBlocks: [
        { start: null, end: null, mins: 20, energy: "full", sports: null },
        { start: null, end: null, mins: 90, energy: "full", sports: null },
      ],
      availableMins: 110,
      workouts: [
        withPurpose({
          day: 0,
          sport: "Run",
          type: "Intervals",
          durationMins: 20,
          intensity: "Z4-Z5",
          description: "d",
          blockIdx: 0,
        }),
        withPurpose({
          day: 0,
          sport: "Run",
          type: "Endurance",
          durationMins: 80,
          intensity: "Z1-Z2",
          description: "d",
          blockIdx: 1,
        }),
      ],
      status: "planned",
    };
    const w = week([
      D("2026-07-20", 60, null, "rest"),
      today,
      D("2026-07-22", 60, null),
      D("2026-07-23", 60, null),
      D("2026-07-24", 60, null),
      D("2026-07-25", 60, null),
      D("2026-07-26", 60, null),
    ]);
    const r = adaptDay({
      week: w,
      today: "2026-07-21",
      band: "red",
      yesterdayCompleted: null,
    });
    const result = r.week.days[1];
    // Intervals' own 20min block can't even hold a 30min recovery spin, so
    // it must be removed — but the untouched 80min Endurance session in
    // the sibling block must survive.
    expect(result.workouts).toHaveLength(1);
    expect(result.workouts[0].type).toBe("Endurance");
    expect(result.workouts[0].durationMins).toBe(80);
    expect(result.status).not.toBe("rest");
    expect(
      r.adjustments.some(
        (a) => a.trigger === "low_readiness" && a.action === "swapped"
      )
    ).toBe(true);
  });
});

describe("adaptDay — race-day guards", () => {
  it("leaves a race day untouched even on red readiness", () => {
    const w = week([
      D("2026-07-20", 60, { durationMins: 45 }),
      D("2026-07-21", 60, { durationMins: 40 }),
      D("2026-07-22", 90, null),
      D("2026-07-23", 0, null, "race"),
      D("2026-07-24", 60, null),
      D("2026-07-25", 60, null),
      D("2026-07-26", 60, null),
    ]);
    w.days[3] = { ...w.days[3], raceName: "Tune-up" };
    const r = adaptDay({
      week: w,
      today: "2026-07-23",
      band: "red",
      yesterdayCompleted: null,
    });
    expect(r.adjustments).toHaveLength(0);
    expect(r.week.days[3].status).toBe("race");
    expect(r.week.days[3].workouts).toHaveLength(0);
  });

  it("no-time move never lands a workout on a race day", () => {
    const w = week([
      D("2026-07-20", 60, null, "rest"),
      D("2026-07-21", 60, null, "rest"),
      D("2026-07-22", 0, { type: "Endurance", durationMins: 45 }),
      D("2026-07-23", 60, { durationMins: 40 }),
      D("2026-07-24", 60, { durationMins: 40 }),
      D("2026-07-25", 120, null, "race"),
      D("2026-07-26", 60, { durationMins: 40 }),
    ]);
    w.days[5] = { ...w.days[5], raceName: "R" };
    const r = adaptDay({
      week: w,
      today: "2026-07-22",
      band: "green",
      yesterdayCompleted: null,
    });
    expect(r.week.days[5].status).toBe("race");
    expect(r.week.days[5].workouts).toHaveLength(0);
    // dropped, not moved anywhere else that would displace the race slot
    expect(
      r.adjustments.some(
        (a) => a.trigger === "no_time" && a.action === "dropped"
      )
    ).toBe(true);
  });

  it("missed-yesterday move-forward search skips a race day and finds the next free day", () => {
    const w = week([
      D("2026-07-20", 60, { type: "Intervals", durationMins: 50 }),
      D("2026-07-21", 20, null), // today: not enough time, skipped as a target
      D("2026-07-22", 90, null, "race"), // would otherwise be picked — must be skipped
      D("2026-07-23", 90, null), // should receive the moved workout instead
      D("2026-07-24", 60, null),
      D("2026-07-25", 60, null),
      D("2026-07-26", 60, null),
    ]);
    w.days[2] = { ...w.days[2], raceName: "R" };
    const r = adaptDay({
      week: w,
      today: "2026-07-21",
      band: "green",
      yesterdayCompleted: false,
    });
    expect(r.week.days[2].status).toBe("race");
    expect(r.week.days[2].workouts).toHaveLength(0);
    const moved = r.week.days.find((d) => d.movedFrom === "2026-07-20");
    expect(moved).toBeDefined();
    expect(moved!.date).toBe("2026-07-23");
  });
});

describe("adaptDay — readiness idempotency", () => {
  const amberWeek = () =>
    week([
      D("2026-07-20", 300, { type: "Long", durationMins: 137 }),
      D("2026-07-21", 300, null),
      D("2026-07-22", 300, null),
      D("2026-07-23", 300, null),
      D("2026-07-24", 300, null),
      D("2026-07-25", 300, null),
      D("2026-07-26", 300, null),
    ]);
  const mins = (w: WeekState) => w.days[0].workouts[0]?.durationMins ?? 0;

  it("applies amber once, however many times it runs", () => {
    let w = amberWeek();
    const first = adaptDay({
      week: w,
      today: "2026-07-20",
      band: "amber",
      yesterdayCompleted: null,
    });
    const once = mins(first.week);
    expect(once).toBe(Math.round(137 * AMBER_SCALE));

    w = first.week;
    for (let i = 0; i < 4; i++) {
      const again = adaptDay({
        week: w,
        today: "2026-07-20",
        band: "amber",
        yesterdayCompleted: null,
      });
      expect(mins(again.week)).toBe(once);
      expect(
        again.adjustments.filter((a) => a.trigger === "low_readiness")
      ).toHaveLength(0);
      w = again.week;
    }
  });

  it("recomputes from the original session when the band worsens", () => {
    // amber then red must equal red applied once — never red on top of amber.
    const amber = adaptDay({
      week: amberWeek(),
      today: "2026-07-20",
      band: "amber",
      yesterdayCompleted: null,
    });
    const thenRed = adaptDay({
      week: amber.week,
      today: "2026-07-20",
      band: "red",
      yesterdayCompleted: null,
    });
    const redOnly = adaptDay({
      week: amberWeek(),
      today: "2026-07-20",
      band: "red",
      yesterdayCompleted: null,
    });
    expect(mins(thenRed.week)).toBe(mins(redOnly.week));
    expect(thenRed.week.days[0].workouts[0]?.type).toBe(
      redOnly.week.days[0].workouts[0]?.type
    );
  });

  it("restores the original session when readiness recovers to green", () => {
    // A day scaled down at 06:00 on amber must come back if the athlete's
    // band improves later the same day — otherwise the morning's worst
    // reading silently governs the whole day.
    const amber = adaptDay({
      week: amberWeek(),
      today: "2026-07-20",
      band: "amber",
      yesterdayCompleted: null,
    });
    const recovered = adaptDay({
      week: amber.week,
      today: "2026-07-20",
      band: "green",
      yesterdayCompleted: null,
    });
    expect(mins(recovered.week)).toBe(137);
  });
});
