// src/lib/week-plan/adapt-day.test.ts
import { describe, expect, it } from "vitest";
import { adaptDay } from "./adapt-day";
import { dayMins } from "./types";
import type { DaySlot, ScheduledWorkout, WeekState } from "./types";
import { withPurpose } from "@/lib/training-plan";
import { blockMins } from "@/lib/availability/types";

function blocksFor(mins: number): DaySlot["availableBlocks"] {
  return mins > 0
    ? [{ start: null, end: null, mins, energy: "normal", sports: null }]
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
    const moved = r.week.days.find((d) => d.movedFrom === "2026-07-21");
    expect(moved?.workouts[0]?.type).toBe("Intervals");
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
