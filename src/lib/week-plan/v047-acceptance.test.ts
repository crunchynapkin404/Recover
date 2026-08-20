import { describe, expect, it } from "vitest";
import { periodize } from "@/lib/training-plan";
import { materializeWeek } from "./materialize";
import { resolveStartStateFromInputs } from "./start-state";

function blocksPerDay(mins: number[]) {
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

describe("v0.47 acceptance matrix", () => {
  it("1) missing CTL/ATL resolves to conservative onboarding profile", () => {
    const out = resolveStartStateFromInputs({
      persisted: null,
      wellness: null,
      sportRolling: null,
    });
    expect(out.ctlSource).toBe("global_fallback");
    expect(out.atlSource).toBe("global_fallback");
    expect(out.startingCtl).toBe(30);
    expect(out.startingAtl).toBe(40);
  });

  it("2) deep negative TSB enters recovery-first opening", () => {
    const blocks = periodize({
      weeksTotal: 12,
      startingCtl: 50,
      daysPerWeek: 5,
      hoursPerWeek: 8,
      sport: "Bike",
      queenStageHours: null,
      startingTsb: -21,
    });
    const week1 = blocks[0];
    expect(week1.targetLoad).toBe(280);
    expect(
      week1.workouts.some((w) => w.day < 3 && w.type === "Intervals")
    ).toBe(false);
  });

  it("3) neutral form + recent illness still enters comeback", () => {
    const r = materializeWeek({
      weekStart: "2026-08-03",
      skeleton: {
        weekNumber: 2,
        phase: "build",
        targetLoadTotal: 400,
        targetSessions: 4,
      },
      availableBlocksPerDay: blocksPerDay([120, 120, 120, 120, 120, 120, 120]),
      prevWeek: { actualLoad: 390, adherencePct: 95 },
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
      hoursPerWeek: 8,
    });

    expect(
      r.adjustments.some(
        (a) => a.reasonCode === "safety_precedence_illness_over_form"
      )
    ).toBe(true);
  });

  it("4) B race normal form gets mini-taper, not A-race ladder", () => {
    const r = materializeWeek({
      weekStart: "2026-08-24",
      skeleton: {
        weekNumber: 9,
        phase: "build",
        targetLoadTotal: 400,
        targetSessions: 5,
      },
      availableBlocksPerDay: blocksPerDay([120, 120, 120, 120, 120, 120, 120]),
      prevWeek: { actualLoad: 390, adherencePct: 95 },
      recentBands: [
        "green",
        "green",
        "green",
        "green",
        "green",
        "green",
        "green",
      ],
      sport: "Run",
      hoursPerWeek: 8,
      races: [
        {
          name: "Tune-up",
          raceType: "10k",
          date: "2026-08-30",
          priority: "B",
        },
      ],
    });

    expect(r.effectiveLoad).toBeLessThan(400);
    expect(r.effectiveLoad).toBeGreaterThan(171);
  });

  it("5) C race during comeback stays constrained by comeback cap", () => {
    const r = materializeWeek({
      weekStart: "2026-08-24",
      skeleton: {
        weekNumber: 9,
        phase: "build",
        targetLoadTotal: 400,
        targetSessions: 5,
      },
      availableBlocksPerDay: blocksPerDay([120, 120, 120, 120, 120, 120, 120]),
      prevWeek: { actualLoad: 390, adherencePct: 95 },
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
      sport: "Run",
      hoursPerWeek: 8,
      races: [
        {
          name: "Parkrun",
          raceType: "5k",
          date: "2026-08-30",
          priority: "C",
        },
      ],
    });

    expect(r.effectiveLoad).toBeLessThanOrEqual(280);
  });

  it("6) contradictory signals resolve safety-first", () => {
    const r = materializeWeek({
      weekStart: "2026-08-24",
      skeleton: {
        weekNumber: 9,
        phase: "build",
        targetLoadTotal: 400,
        targetSessions: 4,
      },
      availableBlocksPerDay: blocksPerDay([120, 120, 120, 120, 120, 120, 120]),
      prevWeek: { actualLoad: 390, adherencePct: 95 },
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
      hoursPerWeek: 8,
    });

    expect(
      r.adjustments.some(
        (a) => a.reasonCode === "safety_precedence_illness_over_form"
      )
    ).toBe(true);
  });

  it("7) generation dependency failure produces safe fallback with reason code", () => {
    const r = materializeWeek({
      weekStart: "2026-08-24",
      skeleton: {
        weekNumber: 9,
        phase: "build",
        targetLoadTotal: 400,
        targetSessions: 4,
      },
      availableBlocksPerDay: blocksPerDay([60, 60, 60, 60, 60, 60, 60]),
      prevWeek: { actualLoad: 390, adherencePct: 95 },
      recentBands: [
        "green",
        "green",
        "green",
        "green",
        "green",
        "green",
        "green",
      ],
      sport: "Swim" as unknown as "Run",
      hoursPerWeek: 8,
    });

    const sessions = r.week.days.flatMap((d) => d.workouts);
    expect(sessions.length).toBeGreaterThan(0);
    expect(sessions.every((w) => w.type === "Recovery")).toBe(true);
    expect(
      r.adjustments.some(
        (a) => a.reasonCode === "safe_fallback_generation_error"
      )
    ).toBe(true);
  });
});
