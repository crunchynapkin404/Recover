import { describe, expect, it } from "vitest";
import { effectiveWeekLoad } from "./materialize";

const greens = Array(7).fill("green") as import("./types").Band[];
const suppressed = [
  "green",
  "amber",
  "red",
  "amber",
  "green",
  "amber",
  "green",
] as import("./types").Band[]; // 4 amber-or-worse

describe("effectiveWeekLoad (hand-computed fixtures)", () => {
  it("returns the skeleton target when last week went to plan", () => {
    const r = effectiveWeekLoad({
      skeletonTarget: 400,
      prevWeek: { actualLoad: 390, adherencePct: 98 },
      recentBands: greens,
    });
    expect(r.load).toBe(400);
    expect(r.reasons).toEqual([]);
  });

  it("builds on actual load, not the skeleton, below 70% adherence", () => {
    // actual 200 × 1.10 = 220; skeleton 400 ignored
    const r = effectiveWeekLoad({
      skeletonTarget: 400,
      prevWeek: { actualLoad: 200, adherencePct: 50 },
      recentBands: greens,
    });
    expect(r.load).toBe(220);
    expect(r.reasons.join(" ")).toContain("adherence");
  });

  it("does not fire the adherence rule at exactly 70%", () => {
    const r = effectiveWeekLoad({
      skeletonTarget: 300,
      prevWeek: { actualLoad: 250, adherencePct: 70 },
      recentBands: greens,
    });
    // only the ramp clamp applies: 250 × 1.2 = 300
    expect(r.load).toBe(300);
  });

  it("reduces 15% when ≥4 of the last 7 days were amber or worse", () => {
    // 400 × 0.85 = 340, then clamp vs actual 380: [304, 456] — 340 stands
    const r = effectiveWeekLoad({
      skeletonTarget: 400,
      prevWeek: { actualLoad: 380, adherencePct: 95 },
      recentBands: suppressed,
    });
    expect(r.load).toBe(340);
    expect(r.reasons.join(" ")).toContain("readiness");
  });

  it("does not reduce at 3 amber-or-worse days", () => {
    const bands = [
      "amber",
      "red",
      "amber",
      "green",
      "green",
      "green",
      "green",
    ] as import("./types").Band[];
    const r = effectiveWeekLoad({
      skeletonTarget: 400,
      prevWeek: { actualLoad: 390, adherencePct: 95 },
      recentBands: bands,
    });
    expect(r.load).toBe(400);
  });

  it("clamps the jump to +20% of previous actual (ramp guard)", () => {
    // skeleton 500 vs actual 300 → clamp to 360
    const r = effectiveWeekLoad({
      skeletonTarget: 500,
      prevWeek: { actualLoad: 300, adherencePct: 90 },
      recentBands: greens,
    });
    expect(r.load).toBe(360);
    expect(r.reasons.join(" ")).toContain("ramp");
  });

  it("clamps a drop to −20% of previous actual", () => {
    // suppressed: 300 × 0.85 = 255; clamp low = 320 × 0.8 = 256
    const r = effectiveWeekLoad({
      skeletonTarget: 300,
      prevWeek: { actualLoad: 320, adherencePct: 95 },
      recentBands: suppressed,
    });
    expect(r.load).toBe(256);
  });

  it("restarts a fully missed week at 60% of skeleton, not at 0", () => {
    // spec-gap rule: ±20% of 0 would freeze the plan at 0 forever
    const r = effectiveWeekLoad({
      skeletonTarget: 400,
      prevWeek: { actualLoad: 0, adherencePct: 0 },
      recentBands: greens,
    });
    expect(r.load).toBe(240);
    expect(r.reasons.join(" ")).toContain("missed");
  });

  it("uses the skeleton as-is for the very first week (no previous)", () => {
    const r = effectiveWeekLoad({
      skeletonTarget: 400,
      prevWeek: null,
      recentBands: [],
    });
    expect(r.load).toBe(400);
  });

  it("calibrating bands never count as amber-or-worse", () => {
    const bands = Array(7).fill("calibrating") as import("./types").Band[];
    const r = effectiveWeekLoad({
      skeletonTarget: 400,
      prevWeek: { actualLoad: 400, adherencePct: 100 },
      recentBands: bands,
    });
    expect(r.load).toBe(400);
  });
});

import { materializeWeek } from "./materialize";
import { isQuality } from "./types";

const baseInput = {
  weekStart: "2026-07-20", // a Monday
  skeleton: {
    weekNumber: 5,
    phase: "build" as const,
    targetLoadTotal: 400,
    targetSessions: 5,
  },
  prevWeek: { actualLoad: 390, adherencePct: 95 },
  recentBands: Array(7).fill("green") as import("./types").Band[],
  raceType: "marathon",
  sports: ["Run"],
  hoursPerWeek: 8,
};

describe("materializeWeek layout", () => {
  it("produces exactly 7 days, Monday first, dates consecutive", () => {
    const r = materializeWeek({
      ...baseInput,
      availabilityMins: [60, 90, 0, 60, 45, 120, 150],
    });
    expect(r.week.days).toHaveLength(7);
    expect(r.week.days[0].date).toBe("2026-07-20");
    expect(r.week.days[6].date).toBe("2026-07-26");
  });

  it("puts the longest session on the roomiest day", () => {
    const r = materializeWeek({
      ...baseInput,
      availabilityMins: [60, 90, 0, 60, 45, 120, 150],
    });
    const sunday = r.week.days[6]; // 150 mins — roomiest
    const durations = r.week.days
      .filter((d) => d.workout)
      .map((d) => d.workout!.durationMins);
    expect(sunday.workout!.durationMins).toBe(Math.max(...durations));
  });

  it("gives a zero-availability day rest, never a workout", () => {
    const r = materializeWeek({
      ...baseInput,
      availabilityMins: [60, 90, 0, 60, 45, 120, 150],
    });
    expect(r.week.days[2].workout).toBeNull();
    expect(r.week.days[2].status).toBe("rest");
  });

  it("never schedules quality sessions on consecutive days", () => {
    const r = materializeWeek({
      ...baseInput,
      availabilityMins: [90, 90, 90, 90, 90, 90, 90],
    });
    for (let i = 1; i < 7; i++) {
      const both =
        isQuality(r.week.days[i - 1].workout) &&
        isQuality(r.week.days[i].workout);
      expect(both).toBe(false);
    }
  });

  it("shortens a workout that exceeds its day and logs no_time", () => {
    const r = materializeWeek({
      ...baseInput,
      availabilityMins: [30, 30, 30, 30, 30, 30, 30],
    });
    for (const d of r.week.days) {
      if (d.workout) expect(d.workout.durationMins).toBeLessThanOrEqual(30);
    }
    expect(r.adjustments.some((a) => a.trigger === "no_time")).toBe(true);
  });

  it("availability wins: too few hours lowers effectiveLoad and logs it", () => {
    const roomy = materializeWeek({
      ...baseInput,
      availabilityMins: [90, 90, 90, 90, 90, 90, 90],
    });
    const tight = materializeWeek({
      ...baseInput,
      availabilityMins: [45, 45, 0, 0, 45, 45, 60],
    });
    expect(tight.effectiveLoad).toBeLessThan(roomy.effectiveLoad);
    expect(
      tight.adjustments.some(
        (a) => a.trigger === "weekly_rollover" && a.reason.includes("lowered")
      )
    ).toBe(true);
  });

  it("an all-zero availability week is all rest — no invented sessions", () => {
    const r = materializeWeek({
      ...baseInput,
      availabilityMins: [0, 0, 0, 0, 0, 0, 0],
    });
    expect(r.week.days.every((d) => d.workout === null)).toBe(true);
    expect(r.week.days.every((d) => d.status === "rest")).toBe(true);
    expect(r.effectiveLoad).toBe(0);
    expect(
      r.adjustments.some(
        (a) => a.trigger === "weekly_rollover" && a.reason.includes("lowered")
      )
    ).toBe(true);
  });

  it("keeps a stepped-down session out of QUALITY_TYPES so adjacency still holds (triathlon)", () => {
    const r = materializeWeek({
      ...baseInput,
      skeleton: { ...baseInput.skeleton, phase: "build", targetSessions: 5 },
      raceType: "ironman",
      sports: ["Swim", "Bike", "Run"],
      availabilityMins: [90, 90, 90, 90, 90, 0, 0],
    });
    for (let i = 1; i < 7; i++) {
      const both =
        isQuality(r.week.days[i - 1].workout) &&
        isQuality(r.week.days[i].workout);
      expect(both).toBe(false);
    }
  });

  it("keeps the primary (longest) session when generateWorkouts over-produces for a small session count", () => {
    const r = materializeWeek({
      ...baseInput,
      availabilityMins: [0, 0, 0, 0, 0, 0, 90],
    });
    const placed = r.week.days.filter((d) => d.workout !== null);
    expect(placed).toHaveLength(1);
    expect(r.week.days[6].workout).not.toBeNull();
    expect(r.week.days[6].workout!.type).toBe("Long");
  });
});

import type { RaceContext } from "@/lib/race/taper";

const AVAIL = [60, 90, 60, 90, 60, 120, 180]; // Mon..Sun
const SKELETON = {
  weekNumber: 10,
  phase: "peak" as const,
  targetLoadTotal: 400,
  targetSessions: 5,
};
const BASE_INPUT = {
  weekStart: "2026-08-24",
  skeleton: SKELETON,
  availabilityMins: AVAIL,
  prevWeek: { actualLoad: 380, adherencePct: 95 },
  recentBands: [] as import("./types").Band[],
  raceType: "marathon",
  sports: ["Run"],
  hoursPerWeek: 8,
};
const A_RACE: RaceContext = {
  date: "2026-08-30", // Sunday of BASE_INPUT week
  priority: "A",
  raceType: "marathon",
  name: "City Marathon",
};

describe("materializeWeek race handling", () => {
  it("A race week: openers only, race slot on race day, rest the day before", () => {
    const r = materializeWeek({ ...BASE_INPUT, races: [A_RACE] });
    const days = r.week.days;
    expect(days[6].status).toBe("race");
    expect(days[6].workout).toBeNull();
    expect(days[6].raceName).toBe("City Marathon");
    expect(days[5].workout).toBeNull(); // Saturday rest
    expect(days[3].workout?.durationMins).toBe(30); // Thursday easy
    expect(days[4].workout?.durationMins).toBe(20); // Friday openers
    // Taper target: 0.45 × 380 = 171
    expect(r.effectiveLoad).toBe(171);
    expect(r.adjustments.some((a) => a.reason.startsWith("taper:"))).toBe(true);
  });

  it("taper bypasses the downward ramp clamp but not the upward one", () => {
    const r = materializeWeek({ ...BASE_INPUT, races: [A_RACE] });
    // 171 is far below 380×0.8=304 — without the bypass it would clamp.
    expect(r.effectiveLoad).toBe(171);
    expect(
      r.adjustments.some((a) =>
        a.reason.includes("ramp guard downward clamp bypassed")
      )
    ).toBe(true);
  });

  it("A race next week (week−1): load reshaped, no race slot", () => {
    const r = materializeWeek({
      ...BASE_INPUT,
      weekStart: "2026-08-17",
      races: [A_RACE],
    });
    expect(r.effectiveLoad).toBe(Math.round(380 * 0.65));
    expect(r.week.days.every((d) => d.status !== "race")).toBe(true);
  });

  it("taper base falls back to currentCtl*7 when no prev week", () => {
    const r = materializeWeek({
      ...BASE_INPUT,
      prevWeek: null,
      currentCtl: 50,
      races: [A_RACE],
    });
    expect(r.effectiveLoad).toBe(Math.round(50 * 7 * 0.45)); // 158
  });

  it("B race: race slot, day before rest, quality 2 days out stepped down", () => {
    const bRace: RaceContext = { ...A_RACE, priority: "B", name: "Tune-up" };
    const r = materializeWeek({ ...BASE_INPUT, races: [bRace] });
    const days = r.week.days;
    expect(days[6].status).toBe("race");
    expect(days[5].workout).toBeNull();
    if (days[4].workout) expect(isQuality(days[4].workout)).toBe(false);
    // No taper reshaping for B: load is the normal effective load.
    expect(r.effectiveLoad).not.toBe(171);
    expect(r.adjustments.some((a) => a.trigger === "race")).toBe(true);
  });

  it("C race: only the race day is replaced", () => {
    const cRace: RaceContext = { ...A_RACE, priority: "C", name: "Parkrun" };
    const r = materializeWeek({ ...BASE_INPUT, races: [cRace] });
    const days = r.week.days;
    expect(days[6].status).toBe("race");
    // Saturday untouched by protection (may or may not hold a workout,
    // but no race-trigger adjustment references it):
    expect(
      r.adjustments
        .filter((a) => a.trigger === "race")
        .every((a) => a.date === "2026-08-30")
    ).toBe(true);
  });

  it("two races: primary (first) reshapes, both get slots", () => {
    const cSat: RaceContext = {
      date: "2026-08-29",
      priority: "C",
      raceType: "5k",
      name: "Shakeout 5k",
    };
    const r = materializeWeek({ ...BASE_INPUT, races: [A_RACE, cSat] });
    expect(r.week.days[6].status).toBe("race");
    expect(r.week.days[5].status).toBe("race");
    expect(r.effectiveLoad).toBe(171); // A won the reshaping
  });
});
