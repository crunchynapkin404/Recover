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
  sport: "Run" as const,
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
      sport: "Triathlon",
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

describe("materializeWeek illness comeback", () => {
  it("caps week load at 70% in strict comeback mode", () => {
    const r = materializeWeek({
      ...baseInput,
      skeleton: {
        ...baseInput.skeleton,
        targetLoadTotal: 500,
      },
      availableBlocksPerDay: blocksPerDay([180, 180, 180, 180, 180, 180, 180]),
      recentBands: [
        "green",
        "green",
        "green",
        "green",
        "green",
        "green",
        "amber",
      ],
      recentIllFlags: [false, false, true, false, false, false, false],
      sport: "Bike",
    });

    expect(r.effectiveLoad).toBeLessThanOrEqual(350);
    expect(
      r.adjustments.some((a) => a.reason.includes("illness comeback"))
    ).toBe(true);
  });

  it("removes intervals while comeback is active", () => {
    const r = materializeWeek({
      ...baseInput,
      availableBlocksPerDay: blocksPerDay([180, 180, 180, 180, 180, 180, 180]),
      recentBands: [
        "green",
        "green",
        "green",
        "green",
        "green",
        "green",
        "amber",
      ],
      recentIllFlags: [false, false, true, false, false, false, false],
      sport: "Bike",
    });

    const types = r.week.days.flatMap((d) => d.workouts.map((w) => w.type));
    expect(types.includes("Intervals")).toBe(false);
  });

  it("logs safety precedence when illness overrides otherwise stable form", () => {
    const r = materializeWeek({
      ...baseInput,
      availableBlocksPerDay: blocksPerDay([120, 120, 120, 120, 120, 120, 120]),
      recentBands: [
        "green",
        "green",
        "green",
        "green",
        "green",
        "green",
        "green",
      ],
      recentIllFlags: [false, false, false, false, false, false, true],
      sport: "Bike",
    });

    expect(
      r.adjustments.some(
        (a) => a.reasonCode === "safety_precedence_illness_over_form"
      )
    ).toBe(true);
  });

  it("falls back to recovery-biased sessions when generation fails", () => {
    const r = materializeWeek({
      ...baseInput,
      // Cast a non-plan sport to force generateWorkouts to throw.
      sport: "Swim" as unknown as "Run",
      availableBlocksPerDay: blocksPerDay([60, 60, 60, 60, 60, 60, 60]),
    });

    const all = r.week.days.flatMap((d) => d.workouts);
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((w) => w.type === "Recovery")).toBe(true);
    expect(
      r.adjustments.some(
        (a) => a.reasonCode === "safe_fallback_generation_error"
      )
    ).toBe(true);
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
    sport: "Bike" as const,
  };

  it("logs an adjustment explaining the cap when the target exceeds what the generator can express", () => {
    // Recalibrated for the cycling-distribution fix (training-plan.ts): the
    // no-demand long-ride/filler bound rose from a hardcoded 90min to
    // longRideBoundMins(null) = 240min, and the remainder that used to be
    // discarded is now redistributed onto whatever hasn't hit its bound. A
    // 20h target here no longer saturates the generator (5 sessions, build,
    // no queenStageHours: totalMins 1200 -> Long min(456,240)=240, Intervals
    // round(1200*0.18)=216, easyMins round(744/3)=248 clamped to 240 x3=720
    // -> scheduled 1176 = 19.6h, only 2% short of 20h — under the 10%
    // GENERATOR_CAP_SHORTFALL_PCT threshold, so no adjustment fires).
    // 40h still legitimately saturates: totalMins 2400 -> Long
    // min(912,240)=240, Intervals round(2400*0.18)=432, easyMins
    // round(1728/3)=576 clamped to 240 x3=720 -> scheduled 1392 = 23.2h
    // (42% short) because Long and all 3 Endurance rides sit at their
    // 240min bound with nowhere left to absorb the remainder — a real "the
    // generator cannot express this", not a discarded remainder.
    const r = materializeWeek({
      ...CAP_BASE,
      hoursPerWeek: 40,
      // Ample availability — 54h across the week — so the shortfall comes
      // from the generator's own duration caps, not a lack of time to ride.
      availableBlocksPerDay: blocksPerDay([360, 480, 360, 480, 360, 600, 600]),
    });
    const capAdjustment = r.adjustments.find((a) =>
      a.reason.includes("session limits cap")
    );
    expect(capAdjustment).toBeDefined();
    expect(capAdjustment!.trigger).toBe("weekly_rollover");
    expect(capAdjustment!.reason).toContain("40.0h target");
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

describe("materializeWeek — event demand reaches the materialized week (Task 3 gap fix)", () => {
  // Task 3 threaded queenStageHours through periodize, but periodize's own
  // Block.workouts are discarded by project.ts/service.ts — only
  // materializeWeek's OWN generateWorkouts call (materialize.ts) produces
  // what actually lands in the week, and it never received queenStageHours.
  // This proves the event-relative long-ride bound now reaches a
  // materialized week rather than stopping at the (unused) skeleton.
  //
  // prevWeek: null and recentBands: [] make effectiveWeekLoad return the
  // skeleton target unchanged (400), so neededHours = hoursPerWeek *
  // (400/400) = hoursPerWeek exactly. Availability is 400min/day × 7 days =
  // 2800min (46.7h) — far above the 13h (780min) target and above the
  // largest single session (296min) — so effectiveHours = hoursPerWeek = 13
  // and nothing here is limited by block-fitting or availability.
  //
  // generateCyclingWorkouts(sessions=5, weekHours=13, phase="build",
  // queenStageHours), totalMins = round(13 * 60) = 780:
  //   Long:            round(780*0.38) = 296, then min(296, longBound)
  //   Intervals:       round(780*0.18) = 140                (same either way)
  //   3 Endurance fillers: allocated = Long+140; easyMins =
  //     round((780-allocated)/3); filler = max(30, min(easyMins, longBound))
  //   remainder = 780 - (Long+Intervals+3*filler), redistributed across
  //     Long+fillers up to their own bound (Intervals excluded).
  //
  // With queenStageHours 4.897963084361944 (the Dolomites value):
  //   longBound = round(4.897963084361944*60) = 294 (between
  //   MIN_LONG_BOUND_MINS=120 and ABSOLUTE_LONG_BOUND_MINS=360, unclamped).
  //   Long = min(296, 294) = 294 — already at its own bound, so it has no
  //   headroom left; the 1min remainder (780 - (294+140+115+115+115) = 1)
  //   goes to a filler instead, not to Long.
  //
  // Without queenStageHours: longBound = NO_DEMAND_LONG_BOUND_MINS = 240.
  //   Long = min(296, 240) = 240 — same reasoning, remainder goes to a
  //   filler, not to Long.
  //
  // 294 > 240: the event-relative bound now reaches the materialized week.
  const BASE = {
    weekStart: "2026-09-07",
    skeleton: {
      weekNumber: 5,
      phase: "build" as const,
      targetLoadTotal: 400,
      targetSessions: 5,
    },
    prevWeek: null,
    recentBands: [] as import("./types").Band[],
    sport: "Bike" as const,
    hoursPerWeek: 13,
    // Generous, uniform availability: block-fitting is never the limiter.
    availableBlocksPerDay: blocksPerDay([400, 400, 400, 400, 400, 400, 400]),
  };

  function longRideMins(r: ReturnType<typeof materializeWeek>): number {
    const day = r.week.days.find((d) =>
      d.workouts.some((w) => w.type === "Long")
    )!;
    return day.workouts.find((w) => w.type === "Long")!.durationMins;
  }

  it("makes the long ride longer when the event's queen stage demands more than the no-demand fallback", () => {
    const withDemand = materializeWeek({
      ...BASE,
      queenStageHours: 4.897963084361944,
    });
    const withoutDemand = materializeWeek(BASE);

    expect(longRideMins(withDemand)).toBe(294);
    expect(longRideMins(withoutDemand)).toBe(240);
    expect(longRideMins(withDemand)).toBeGreaterThan(
      longRideMins(withoutDemand)
    );
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
  sport: "Run" as const,
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

  it('triathlon race week: pre-race sessions carry a real discipline, never the pseudo-sport "Triathlon", and are admitted by a Swim-restricted block', () => {
    // Thursday (raceIdx-3) and Friday (raceIdx-2) — exactly where
    // raceWeekWorkouts places the pre-race easy session and the openers —
    // are restricted to Swim only, as an availability block built around a
    // swim squad session would be. Before the F1 fix, raceWeekWorkouts was
    // called with the plan's PlanSport ("Triathlon") rather than a real
    // PlanDiscipline, so admits() rejected both sessions against this
    // block and they were silently dropped in the athlete's race week.
    const availableBlocksPerDay = blocksPerDay(AVAIL);
    availableBlocksPerDay[3] = [
      {
        start: null,
        end: null,
        mins: 60,
        energy: "full" as const,
        sports: ["Swim"],
      },
    ];
    availableBlocksPerDay[4] = [
      {
        start: null,
        end: null,
        mins: 90,
        energy: "full" as const,
        sports: ["Swim"],
      },
    ];
    const triRace: RaceContext = { ...A_RACE, raceType: "triathlon" };
    const r = materializeWeek({
      ...BASE_INPUT,
      sport: "Triathlon",
      availableBlocksPerDay,
      races: [triRace],
    });
    const allWorkouts = r.week.days.flatMap((d) => d.workouts);
    expect(allWorkouts.length).toBeGreaterThan(0);
    expect(allWorkouts.every((w) => w.sport !== "Triathlon")).toBe(true);
    expect(
      allWorkouts.every((w) =>
        (["Swim", "Bike", "Run"] as string[]).includes(w.sport)
      )
    ).toBe(true);
    // Both pre-race sessions actually landed on their intended day, proving
    // the Swim-restricted block admitted them rather than dropping them.
    expect(r.week.days[3].workouts).toHaveLength(1);
    expect(r.week.days[3].workouts[0]?.sport).toBe("Swim");
    expect(r.week.days[4].workouts).toHaveLength(1);
    expect(r.week.days[4].workouts[0]?.sport).toBe("Swim");
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

  // Review finding (Task 4 re-review), Finding 2: when the skeleton itself
  // already fell inside periodize()'s taper phase (v0.45 Task 4:
  // targetLoadTotal is then `round(preTaperLoad * ladderFraction)`, already
  // ladder-scaled once), the fallback tier above (no prevWeek.actualLoad,
  // no currentCtl) used to multiply that already-scaled number by
  // taperFraction a SECOND time. Reachability is broader than "brand-new
  // athlete's first week": `hasActualLoad` is also false after a fully
  // missed week (prevWeek.actualLoad === 0), so this fixture — no prev
  // week, no CTL — stands in for any no-synced-CTL athlete hitting this
  // path mid-plan too (a missed week, a rollover, or a race reschedule),
  // not only a cold start. On this path the plan-position fraction
  // (periodize's targetLoadTotal) wins outright over the real-date
  // fraction (taperFraction here) rather than the latter rescaling it.
  it("does not double-apply the ladder when the skeleton is already a taper week and there is no prev week or CTL (cold start)", () => {
    const r = materializeWeek({
      ...BASE_INPUT,
      prevWeek: null,
      currentCtl: null,
      // 266 stands in for periodize()'s real race-week output — see
      // training-plan.test.ts's characterization fixture, where a 12-week
      // plan's own race week is exactly round(590.8 * 0.45) = 266 — i.e.
      // already one full ladder application away from the true anchor.
      skeleton: { ...SKELETON, phase: "taper" as const, targetLoadTotal: 266 },
      races: [A_RACE],
    });
    // Before the fix: round(266 * 0.45) = 120 — a second 0.45 stacked on
    // top of periodize()'s own 0.45, landing at ~0.20 of the real anchor
    // (590.8) instead of ~0.45. After the fix: the already-scaled 266 is
    // accepted as final.
    expect(r.effectiveLoad).toBe(266);
  });

  // v0.45 Task 4 re-review, Finding 3: nothing asserted on `reason` before
  // this, so the athlete/coach-facing adjustment text could drift silently
  // from what the code actually did. On the cold-start path the raw
  // "X% of current load" phrasing would be a lie — 266 is NOT 45% of
  // anything computed here, it is periodize()'s own already-scaled number
  // passed through unchanged. Pin the honest text so this cannot drift back.
  it("cold-start reason text says the ladder was kept as-is, not that a percentage was applied", () => {
    const r = materializeWeek({
      ...BASE_INPUT,
      prevWeek: null,
      currentCtl: null,
      skeleton: { ...SKELETON, phase: "taper" as const, targetLoadTotal: 266 },
      races: [A_RACE],
    });
    const adj = r.adjustments.find((a) => a.trigger === "race");
    expect(adj?.reason).toBe(
      `taper: ${A_RACE.name} on ${A_RACE.date} — no actual load or synced CTL to rescale, so the plan's own taper ladder stands unscaled: week target 266`
    );
    // Must NOT claim a percentage was applied to produce 266 — it wasn't.
    expect(adj?.reason).not.toMatch(/% of current load/);
  });

  it("B race: race slot, pre-day opener or rest, and 2-day intensity reduction", () => {
    const bRace: RaceContext = { ...A_RACE, priority: "B", name: "Tune-up" };
    const r = materializeWeek({ ...BASE_INPUT, races: [bRace] });
    const days = r.week.days;
    expect(days[6].status).toBe("race");
    // Low-fatigue B race gets an opener; high fatigue keeps rest.
    expect(["planned", "rest"]).toContain(days[5].status);
    if (days[4].workouts[0]) {
      expect(days[4].workouts[0].type === "Intervals").toBe(false);
    }
    // B mini taper applies a week-level reduction.
    expect(r.effectiveLoad).toBeLessThan(400);
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
      sport: "Bike",
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
    // B-race tune drops each quality session by one rung.
    expect(friday.workouts.some((w) => w.type === "Tempo")).toBe(true);
    expect(friday.workouts.some((w) => w.type === "Intervals")).toBe(false);
    expect(
      r.adjustments.some(
        (a) => a.date === friday.date && a.reason.includes("lowered intensity")
      )
    ).toBe(true);
  });

  it("C race: only the race day is replaced", () => {
    const cRace: RaceContext = { ...A_RACE, priority: "C", name: "Parkrun" };
    const r = materializeWeek({ ...BASE_INPUT, races: [cRace] });
    const days = r.week.days;
    expect(days[6].status).toBe("race");
    // Saturday untouched by protection (may or may not hold a workout, but
    // no pre-race-day protection adjustment references it). The week's own
    // missing-taper note (v0.45 Task 6 — a C race gets no taper either) is
    // the one legitimate "race"-trigger adjustment NOT dated on race day,
    // since it describes the whole week, not a specific day — excluded
    // here rather than folded into "no protection touched Saturday".
    expect(
      r.adjustments
        .filter((a) => a.trigger === "race" && !a.reason.includes("no taper"))
        .every((a) => a.date === "2026-08-30")
    ).toBe(true);
    const note = r.adjustments.find((a) => a.reason.includes("no taper"));
    expect(note).toBeDefined();
    expect(note!.date).toBe(BASE_INPUT.weekStart);
    expect(note!.reason).toContain("Parkrun");
    expect(note!.reason).toContain("priority C");
    // The note must not claim the week is untouched: periodize()'s own
    // end-of-plan taper still reduces it, just not by the race ladder.
    expect(note!.reason).toContain("end-of-plan taper");
    expect(note!.reason).toContain("partial reduction");
    expect(note!.reason).not.toContain("full load");
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
    sport: "Bike" as const,
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
        sport: "Triathlon",
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
        sport: "Triathlon",
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
        sport: "Run",
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

describe("restIntent", () => {
  it("uses a B-race opener on the day before when fatigue is not high", () => {
    // Same BASE_INPUT/A_RACE fixture the neighbouring "B race" test uses,
    // just with priority swapped to B. This is the STRIP path: a B race
    // takes the normal weekly-generation route, so Saturday (raceIdx-1, one
    // day before A_RACE's Sunday) really does get a session first, which
    // the A/B protection then has to remove — and the removal is logged as
    // a "dropped" adjustment. An A race reaches the same producer without
    // ever holding a session there; that case is covered separately below.
    const bRace: RaceContext = { ...A_RACE, priority: "B", name: "Tune-up" };
    const { week } = materializeWeek({ ...BASE_INPUT, races: [bRace] });

    expect(week.days[5].status).toBe("planned");
    expect(week.days[5].workouts[0]?.description).toContain("Pre-race opener");
    expect(week.days[5].restIntent).toBeUndefined();
  });

  it("leaves an ordinary empty day unmarked", () => {
    const { week } = materializeWeek(BASE_INPUT);

    const empty = week.days.filter((d) => d.workouts.length === 0);
    expect(empty.length).toBeGreaterThan(0);
    for (const d of empty) expect(d.restIntent).toBeUndefined();
  });

  it("marks the day before an A-priority race too, even though raceWeekWorkouts never leaves anything there to strip", () => {
    // A_RACE (priority "A") reshapes via raceWeekWorkouts, which never
    // schedules anything on raceIdx-1 in the first place — so this day is
    // naturally empty, not stripped. It still must carry restIntent, since
    // that field (not "did a workout get removed") is the fill rung's only
    // race signal. And because nothing was actually dropped here, no
    // adjustment record should claim otherwise.
    const r = materializeWeek({ ...BASE_INPUT, races: [A_RACE] });

    expect(r.week.days[5].restIntent).toBe("pre_race");
    expect(
      r.adjustments.some(
        (a) => a.date === r.week.days[5].date && a.action === "dropped"
      )
    ).toBe(false);
  });
});

describe("a B/C race's missing taper is recorded", () => {
  const base = {
    weekStart: "2026-08-24",
    skeleton: {
      weekNumber: 5,
      phase: "build" as const,
      targetLoadTotal: 500,
      targetSessions: 5,
    },
    availableBlocksPerDay: Array.from({ length: 7 }, () => []),
    prevWeek: null,
    recentBands: [],
    sport: "Bike" as const,
    hoursPerWeek: 8,
    currentCtl: 50,
    queenStageHours: null,
  };

  it("records a reason when the primary race is priority B", () => {
    const r = materializeWeek({
      ...base,
      races: [
        {
          date: "2026-08-29",
          priority: "B",
          raceType: "Criterium",
          name: "Club crit",
        },
      ],
    });
    const note = r.adjustments.find((a) => a.reason.includes("no taper"));
    expect(note).toBeDefined();
    expect(note!.trigger).toBe("race");
    // Dated at the week start, not race day — this note describes the
    // whole week's load, not a single day. A regression that dated it on
    // race day would still pass a substring check on `reason`; only this
    // assertion on `date` catches it directly.
    expect(note!.date).toBe(base.weekStart);
    expect(note!.reason).toContain("Club crit");
    expect(note!.reason).toContain("priority B");
    // The note must not claim the week is untouched: periodize()'s own
    // end-of-plan taper still reduces it, just not by the race ladder.
    expect(note!.reason).toContain("end-of-plan taper");
    expect(note!.reason).toContain("partial reduction");
    expect(note!.reason).not.toContain("full load");
  });

  it("records nothing for a week with no races at all", () => {
    const r = materializeWeek({ ...base, races: [] });
    expect(
      r.adjustments.find((a) => a.reason.includes("no taper"))
    ).toBeUndefined();
  });

  it("records nothing when the primary race is priority A", () => {
    const r = materializeWeek({
      ...base,
      races: [
        {
          date: "2026-08-29",
          priority: "A",
          raceType: "Criterium",
          name: "Big crit",
        },
      ],
    });
    expect(
      r.adjustments.find((a) => a.reason.includes("no taper"))
    ).toBeUndefined();
  });

  it("records nothing for a B race outside its taper window", () => {
    const r = materializeWeek({
      ...base,
      weekStart: "2026-06-01", // months out
      races: [
        {
          date: "2026-08-29",
          priority: "B",
          raceType: "Criterium",
          name: "Club crit",
        },
      ],
    });
    expect(
      r.adjustments.find((a) => a.reason.includes("no taper"))
    ).toBeUndefined();
  });
});
