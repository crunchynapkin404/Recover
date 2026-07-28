import { describe, expect, it } from "vitest";
import { effectiveWeekLoad } from "./materialize";
import { dayMins } from "./types";

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
import type { AvailabilityBlock } from "@/lib/availability/types";

/**
 * Legacy per-day-minutes fixtures, wrapped into a single full-energy block
 * per day (or no blocks at all when a day's number is 0). These tests only
 * ever cared about "how much time on this day", not block shape.
 */
function blocksPerDay(mins: number[]): AvailabilityBlock[][] {
  return mins.map((m) =>
    m > 0
      ? [
          {
            start: null,
            end: null,
            mins: m,
            energy: "full" as const,
            sports: null,
          },
        ]
      : []
  );
}

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
      availableBlocksPerDay: blocksPerDay([60, 90, 0, 60, 45, 120, 150]),
    });
    expect(r.week.days).toHaveLength(7);
    expect(r.week.days[0].date).toBe("2026-07-20");
    expect(r.week.days[6].date).toBe("2026-07-26");
  });

  it("puts the longest session on the roomiest day", () => {
    const r = materializeWeek({
      ...baseInput,
      availableBlocksPerDay: blocksPerDay([60, 90, 0, 60, 45, 120, 150]),
    });
    const sunday = r.week.days[6]; // 150 mins — roomiest
    const durations = r.week.days
      .filter((d) => d.workouts.length > 0)
      .map((d) => d.workouts[0].durationMins);
    expect(sunday.workouts[0].durationMins).toBe(Math.max(...durations));
  });

  it("gives a zero-availability day rest, never a workout", () => {
    const r = materializeWeek({
      ...baseInput,
      availableBlocksPerDay: blocksPerDay([60, 90, 0, 60, 45, 120, 150]),
    });
    expect(r.week.days[2].workouts).toHaveLength(0);
    expect(r.week.days[2].status).toBe("rest");
  });

  it("never schedules quality sessions on consecutive days", () => {
    const r = materializeWeek({
      ...baseInput,
      availableBlocksPerDay: blocksPerDay([90, 90, 90, 90, 90, 90, 90]),
    });
    for (let i = 1; i < 7; i++) {
      const both =
        isQuality(r.week.days[i - 1].workouts[0] ?? null) &&
        isQuality(r.week.days[i].workouts[0] ?? null);
      expect(both).toBe(false);
    }
  });

  it("shortens a workout that exceeds its day and logs no_time", () => {
    const r = materializeWeek({
      ...baseInput,
      availableBlocksPerDay: blocksPerDay([30, 30, 30, 30, 30, 30, 30]),
    });
    for (const d of r.week.days) {
      if (d.workouts[0])
        expect(d.workouts[0].durationMins).toBeLessThanOrEqual(30);
    }
    expect(r.adjustments.some((a) => a.trigger === "no_time")).toBe(true);
  });

  it("availability wins: too few hours lowers effectiveLoad and logs it", () => {
    const roomy = materializeWeek({
      ...baseInput,
      availableBlocksPerDay: blocksPerDay([90, 90, 90, 90, 90, 90, 90]),
    });
    const tight = materializeWeek({
      ...baseInput,
      availableBlocksPerDay: blocksPerDay([45, 45, 0, 0, 45, 45, 60]),
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
      availableBlocksPerDay: blocksPerDay([0, 0, 0, 0, 0, 0, 0]),
    });
    expect(r.week.days.every((d) => d.workouts.length === 0)).toBe(true);
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
      availableBlocksPerDay: blocksPerDay([90, 90, 90, 90, 90, 0, 0]),
    });
    for (let i = 1; i < 7; i++) {
      const both =
        isQuality(r.week.days[i - 1].workouts[0] ?? null) &&
        isQuality(r.week.days[i].workouts[0] ?? null);
      expect(both).toBe(false);
    }
  });

  it("keeps the primary (longest) session when generateWorkouts over-produces for a small session count", () => {
    const r = materializeWeek({
      ...baseInput,
      availableBlocksPerDay: blocksPerDay([0, 0, 0, 0, 0, 0, 90]),
    });
    const placed = r.week.days.filter((d) => d.workouts.length > 0);
    expect(placed).toHaveLength(1);
    expect(r.week.days[6].workouts).toHaveLength(1);
    expect(r.week.days[6].workouts[0].type).toBe("Long");
  });
});

describe("materializeWeek — generator cap explained (final-review Finding 2)", () => {
  // generateWorkouts hard-caps the long ride/run and every filler session
  // regardless of the target it is asked for, so a large-enough target
  // saturates the generator far below effectiveHours with no adjustment of
  // its own — the exact unexplained-deficit failure mode WeekRationale
  // exists to eliminate. These pin the new adjustment materializeWeek must
  // push when that happens, and its absence when the generator can meet the
  // target.
  const CAP_BASE = {
    weekStart: "2026-08-24",
    skeleton: {
      weekNumber: 5,
      phase: "build" as const,
      targetLoadTotal: 400,
      targetSessions: 5,
    },
    prevWeek: null,
    recentBands: [] as import("./types").Band[],
    raceType: "gran fondo",
    sports: ["Bike"],
  };

  it("logs an adjustment explaining the cap when the target exceeds what the generator can express", () => {
    const r = materializeWeek({
      ...CAP_BASE,
      hoursPerWeek: 20,
      // Ample availability — 27h across the week — so the shortfall comes
      // from the generator's own duration caps, not a lack of time to ride.
      availableBlocksPerDay: blocksPerDay([180, 240, 180, 240, 180, 300, 300]),
    });
    const capAdjustment = r.adjustments.find((a) =>
      a.reason.includes("session limits cap")
    );
    expect(capAdjustment).toBeDefined();
    expect(capAdjustment!.trigger).toBe("weekly_rollover");
    expect(capAdjustment!.reason).toContain("20.0h target");
  });

  it("logs no cap adjustment when the target is within what the generator can produce", () => {
    const r = materializeWeek({
      ...CAP_BASE,
      hoursPerWeek: 6,
      availableBlocksPerDay: blocksPerDay([60, 60, 60, 60, 60, 90, 90]),
    });
    expect(
      r.adjustments.some((a) => a.reason.includes("session limits cap"))
    ).toBe(false);
  });
});

describe("DaySlot shape", () => {
  it("sums a day's blocks rather than trusting availableMins", () => {
    const day = {
      date: "2026-08-03",
      availableBlocks: [
        {
          start: "06:30",
          end: "07:15",
          mins: 45,
          energy: "normal" as const,
          sports: null,
        },
        {
          start: "19:00",
          end: "20:00",
          mins: 60,
          energy: "normal" as const,
          sports: null,
        },
      ],
      workouts: [],
      availableMins: 999, // deliberately wrong: nothing may trust it
      status: "rest" as const,
    };
    expect(dayMins(day)).toBe(105);
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
  availableBlocksPerDay: blocksPerDay(AVAIL),
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
    expect(days[6].workouts).toHaveLength(0);
    expect(days[6].raceName).toBe("City Marathon");
    expect(days[5].workouts).toHaveLength(0); // Saturday rest
    expect(days[3].workouts[0]?.durationMins).toBe(30); // Thursday easy
    expect(days[4].workouts[0]?.durationMins).toBe(20); // Friday openers
    // Taper target: 0.45 × 380 = 171
    expect(r.effectiveLoad).toBe(171);
    expect(r.adjustments.some((a) => a.reason.startsWith("taper:"))).toBe(true);
  });

  it("never drops a race-week session without logging why — energy tier mismatch", () => {
    // Friday (raceIdx - 2) is where the Tempo opener lands. Give it minutes
    // but only an "easy" block — ENERGY_CEILING["easy"] excludes "threshold"
    // (Tempo's purpose), so findBlockFor returns null even though the day
    // isn't empty. The opener must not vanish with no trace.
    const availableBlocksPerDay = blocksPerDay(AVAIL);
    availableBlocksPerDay[4] = [
      {
        start: null,
        end: null,
        mins: 90,
        energy: "easy" as const,
        sports: null,
      },
    ];
    const r = materializeWeek({
      ...BASE_INPUT,
      availableBlocksPerDay,
      races: [A_RACE],
    });
    const friday = r.week.days[4];
    const placedOnFriday = friday.workouts.length > 0;
    const loggedDrop = r.adjustments.some(
      (a) => a.reason.includes(friday.date) && a.reason.includes("Tempo")
    );
    expect(placedOnFriday || loggedDrop).toBe(true);
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
    expect(days[5].workouts).toHaveLength(0);
    if (days[4].workouts[0]) expect(isQuality(days[4].workouts[0])).toBe(false);
    // No taper reshaping for B: load is the normal effective load.
    expect(r.effectiveLoad).not.toBe(171);
    expect(r.adjustments.some((a) => a.trigger === "race")).toBe(true);
  });

  it("I9: steps down every quality session 2 days before the race, not just workouts[0], and never drops a sibling", () => {
    // Only Friday (raceIdx - 2) has any availability, split across two
    // blocks — forcing both generated sessions onto that one day. Cycling
    // in build/peak phase always generates a bigger, non-quality Long ride
    // first and a smaller, quality Intervals session second, so Friday
    // ends up [Long@block0 (non-quality), Intervals@block1 (quality)] —
    // quality landing at index 1, exactly the position the old
    // `isQuality(workouts[0])` check could never see.
    const bRace: RaceContext = { ...A_RACE, priority: "B", name: "Tune-up" };
    const blocks = (mins: number[]) =>
      mins.map((m) => ({
        start: null,
        end: null,
        mins: m,
        energy: "full" as const,
        sports: null,
      }));
    const r = materializeWeek({
      ...BASE_INPUT,
      skeleton: { ...SKELETON, targetSessions: 2 },
      sports: ["Bike"],
      raceType: "Gran Fondo",
      hoursPerWeek: 6,
      prevWeek: null,
      availableBlocksPerDay: [
        blocks([]),
        blocks([]),
        blocks([]),
        blocks([]),
        blocks([300, 150]), // Friday
        blocks([]),
        blocks([]),
      ],
      races: [bRace],
    });

    const friday = r.week.days[4];
    // Both sessions must survive — the bug rebuilt the day as a
    // one-element array, silently dropping whichever wasn't workouts[0].
    expect(friday.workouts).toHaveLength(2);
    expect(friday.workouts.some((w) => w.type === "Long")).toBe(true);
    // No quality session may remain 2 days before a non-C race, regardless
    // of which index it was generated into.
    expect(friday.workouts.every((w) => !isQuality(w))).toBe(true);
    expect(
      r.adjustments.some(
        (a) => a.date === friday.date && a.reason.includes("stepped down")
      )
    ).toBe(true);
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

describe("materializeWeek — block fitting", () => {
  const blocks = (mins: number[]) =>
    mins.map((m) => ({
      start: null,
      end: null,
      mins: m,
      energy: "full" as const,
      sports: null,
    }));

  const base = {
    weekStart: "2026-08-03",
    skeleton: {
      weekNumber: 3,
      phase: "build" as const,
      targetLoadTotal: 400,
      targetSessions: 4,
    },
    prevWeek: null,
    recentBands: [],
    raceType: "Gran Fondo",
    sports: ["Bike"],
    hoursPerWeek: 8,
  };

  it("never schedules a session longer than any single block", () => {
    const r = materializeWeek({
      ...base,
      availableBlocksPerDay: [
        blocks([45, 60]), // 105 total, but no block over 60
        blocks([]),
        blocks([]),
        blocks([]),
        blocks([]),
        blocks([]),
        blocks([]),
      ],
    });
    for (const d of r.week.days) {
      for (const w of d.workouts) {
        expect(
          Math.max(0, ...d.availableBlocks.map((b) => b.mins))
        ).toBeGreaterThanOrEqual(w.durationMins);
      }
    }
  });

  it("does not truncate a session to fit — it places a fitting one instead", () => {
    const r = materializeWeek({
      ...base,
      availableBlocksPerDay: [
        blocks([50]),
        blocks([50]),
        blocks([50]),
        blocks([50]),
        blocks([50]),
        blocks([50]),
        blocks([50]),
      ],
    });
    // Every placed session is at or above its own floor: nothing was
    // clipped below the point where it stops delivering its stimulus.
    for (const d of r.week.days) {
      for (const w of d.workouts) {
        expect(w.durationMins).toBeGreaterThanOrEqual(w.minEffectiveMins);
      }
    }
  });

  it("never drops a session without saying why", () => {
    const r = materializeWeek({
      ...base,
      availableBlocksPerDay: [
        blocks([30]),
        blocks([30]),
        blocks([30]),
        blocks([30]),
        blocks([30]),
        blocks([30]),
        blocks([30]),
      ],
    });
    const planned = r.week.days.reduce((s, d) => s + d.workouts.length, 0);
    // Whatever the engine could not place must be accounted for.
    if (planned < base.skeleton.targetSessions) {
      expect(
        r.adjustments.some(
          (a) => a.action === "dropped" || a.action === "swapped"
        )
      ).toBe(true);
    }
  });

  it("can place two sessions on a day with two blocks", () => {
    const r = materializeWeek({
      ...base,
      skeleton: { ...base.skeleton, targetSessions: 2 },
      availableBlocksPerDay: [
        blocks([90, 90]),
        blocks([]),
        blocks([]),
        blocks([]),
        blocks([]),
        blocks([]),
        blocks([]),
      ],
    });
    expect(r.week.days[0].workouts.length).toBe(2);
  });

  it("records which block each placed session occupies", () => {
    const r = materializeWeek({
      ...base,
      skeleton: { ...base.skeleton, targetSessions: 2 },
      availableBlocksPerDay: [
        blocks([90, 90]),
        blocks([]),
        blocks([]),
        blocks([]),
        blocks([]),
        blocks([]),
        blocks([]),
      ],
    });
    const day = r.week.days[0];
    expect(day.workouts.length).toBe(2);
    const used = day.workouts.map((w) => w.blockIdx);
    expect(new Set(used).size).toBe(2); // two distinct blocks
    for (const w of day.workouts) {
      expect(day.availableBlocks[w.blockIdx]).toBeDefined();
    }
  });

  describe("fallback path: quality adjacency and same-day rules", () => {
    it("never places two quality sessions on adjacent days, even when a session only fits via the relaxed fallback", () => {
      // Triathlon build week: Monday is roomy enough to take the biggest
      // session whole (Brick); Tuesday is a middling block that can't fit
      // the swim Intervals session whole, so it falls to the relaxed
      // fitting path. That path must still honour quality adjacency.
      const r = materializeWeek({
        ...base,
        skeleton: { ...base.skeleton, targetSessions: 3 },
        raceType: "Ironman 70.3",
        sports: ["Swim", "Bike", "Run"],
        hoursPerWeek: 20,
        availableBlocksPerDay: blocksPerDay([1100, 100, 90, 90, 90, 90, 90]),
      });
      for (let i = 1; i < 7; i++) {
        const prevQuality = r.week.days[i - 1].workouts.some(isQuality);
        const dayQuality = r.week.days[i].workouts.some(isQuality);
        expect(prevQuality && dayQuality).toBe(false);
      }
    });

    it("never places two quality sessions on the same day via the relaxed fallback", () => {
      // Same triathlon week, but only Monday has any availability (two
      // blocks: 1100min and 100min). The fallback must not pack a second
      // quality session into Monday's smaller block just because the day
      // isn't at its session cap yet.
      const r = materializeWeek({
        ...base,
        skeleton: { ...base.skeleton, targetSessions: 3 },
        raceType: "Ironman 70.3",
        sports: ["Swim", "Bike", "Run"],
        hoursPerWeek: 20,
        availableBlocksPerDay: [
          blocks([1100, 100]),
          blocks([]),
          blocks([]),
          blocks([]),
          blocks([]),
          blocks([]),
          blocks([]),
        ],
      });
      for (const d of r.week.days) {
        expect(d.workouts.filter(isQuality).length).toBeLessThanOrEqual(1);
      }
    });

    it("uses a smaller, non-adjacent slot instead of dropping the session or violating adjacency", () => {
      // Wednesday is by far the roomiest block and takes the Intervals
      // session whole. The next-biggest remaining block (Thursday) is
      // adjacent to Wednesday, so once Tempo can't fit anywhere whole, the
      // roomiest fallback candidate (Thursday) must be rejected for
      // adjacency — but Saturday, a smaller and non-adjacent block, still
      // fits it. The session must land there rather than being dropped.
      const r = materializeWeek({
        ...base,
        skeleton: { ...base.skeleton, targetSessions: 4 },
        raceType: "Marathon",
        sports: ["Run"],
        hoursPerWeek: 20,
        availableBlocksPerDay: [
          blocks([60]), // Mon
          blocks([60]), // Tue
          blocks([700]), // Wed — roomiest, takes Intervals whole
          blocks([170]), // Thu — adjacent to Wed, would be the fallback's
          // first-tried candidate, but must be rejected for adjacency
          blocks([50]), // Fri
          blocks([100]), // Sat — smaller, non-adjacent, still fits
          blocks([90]), // Sun
        ],
      });

      expect(r.adjustments.some((a) => a.action === "dropped")).toBe(false);

      for (let i = 1; i < 7; i++) {
        const prevQuality = r.week.days[i - 1].workouts.some(isQuality);
        const dayQuality = r.week.days[i].workouts.some(isQuality);
        expect(prevQuality && dayQuality).toBe(false);
      }
      for (const d of r.week.days) {
        expect(d.workouts.filter(isQuality).length).toBeLessThanOrEqual(1);
      }
    });
  });
});

describe("materializeWeek availability scaling (Task 9 regression)", () => {
  // 6h of availability against a 10h week. materializeWeek is the ONE place
  // availability lowers the week's load, which is why rolloverWeekPlan hands
  // it the pre-availability target.
  const sixHours = blocksPerDay([60, 60, 60, 60, 60, 60, 0]);

  it("lowers the week load, and says so, when time is short", () => {
    const r = materializeWeek({
      ...baseInput,
      hoursPerWeek: 10,
      availableBlocksPerDay: sixHours,
    });
    // needed 10h vs 6h budget: 400 × 6/10 = 240
    expect(r.effectiveLoad).toBe(240);
    expect(
      r.adjustments.some((a) => a.reason.includes("available instead of"))
    ).toBe(true);
  });

  it("does nothing once the target has already been clamped to availability", () => {
    // The defect this guards: pre-clamping to 6h makes the branch above
    // unreachable, so the week keeps its full 400 load with only 6h to ride
    // it and the athlete is never told why.
    const r = materializeWeek({
      ...baseInput,
      hoursPerWeek: 6,
      availableBlocksPerDay: sixHours,
    });
    expect(r.effectiveLoad).toBe(400);
    expect(
      r.adjustments.some((a) => a.reason.includes("available instead of"))
    ).toBe(false);
  });
});
