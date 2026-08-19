import { describe, expect, it } from "vitest";
import {
  buildPhases,
  collectWarnings,
  type PlanPhase,
  type WarningInput,
} from "./plan-preview";
import { periodize } from "./training-plan";

describe("buildPhases", () => {
  it("gives recovery its own row rather than folding it into a phase", () => {
    const rows = buildPhases([
      { weekNumber: 1, phase: "base" },
      { weekNumber: 2, phase: "base" },
      { weekNumber: 3, phase: "recovery" },
      { weekNumber: 4, phase: "build" },
    ]);

    expect(rows).toEqual([
      { phase: "base", weeks: 2, weekNumbers: [1, 2] },
      { phase: "build", weeks: 1, weekNumbers: [4] },
      { phase: "recovery", weeks: 1, weekNumbers: [3] },
    ]);
  });

  it("orders week numbers ascending within a row", () => {
    const rows = buildPhases([
      { weekNumber: 9, phase: "base" },
      { weekNumber: 2, phase: "base" },
    ]);
    expect(rows[0].weekNumbers).toEqual([2, 9]);
  });

  // The property the athlete actually checks on screen.
  it.each([1, 2, 4, 8, 12, 16, 20, 24, 32, 40, 52])(
    "rows sum to weeksTotal for a %i-week plan",
    (weeksTotal) => {
      const blocks = periodize({
        weeksTotal,
        startingCtl: 45,
        daysPerWeek: 5,
        hoursPerWeek: 8,
        sport: "Bike",
      });
      const rows = buildPhases(
        blocks.map((b) => ({
          weekNumber: b.weekNumber,
          phase: b.phase as PlanPhase,
        }))
      );

      const summed = rows.reduce((s, r) => s + r.weeks, 0);
      expect(summed).toBe(weeksTotal);

      const seen = rows.flatMap((r) => r.weekNumbers).sort((a, b) => a - b);
      expect(seen).toEqual(Array.from({ length: weeksTotal }, (_, i) => i + 1));
    }
  );
});

const clean: WarningInput = {
  startingCtlSource: "wellness",
  volumeSource: "race",
  hasShortfall: false,
  feasibilityVerdict: "on_track",
  raceCreated: false,
  availabilitySeeded: false,
  shortHorizon: false,
};

describe("collectWarnings", () => {
  it("says nothing when nothing is wrong", () => {
    expect(collectWarnings(clean)).toEqual([]);
  });

  it.each([
    [{ startingCtlSource: "global_fallback" as const }, "no_ctl_history"],
    [{ volumeSource: "fallback" as const }, "volume_fallback"],
    [{ hasShortfall: true }, "availability_binds"],
    [{ feasibilityVerdict: "tight" as const }, "feasibility_tight"],
    [
      { feasibilityVerdict: "not_realistic" as const },
      "feasibility_not_realistic",
    ],
    [{ raceCreated: true }, "race_created"],
    [{ availabilitySeeded: true }, "availability_seeded"],
    [{ shortHorizon: true }, "short_horizon"],
  ])("%o raises %s and nothing else", (patch, expected) => {
    expect(collectWarnings({ ...clean, ...patch })).toEqual([expected]);
  });

  it("reports every warning at once, in table order", () => {
    expect(
      collectWarnings({
        startingCtlSource: "global_fallback",
        volumeSource: "fallback",
        hasShortfall: true,
        feasibilityVerdict: "not_realistic",
        raceCreated: true,
        availabilitySeeded: true,
        shortHorizon: true,
      })
    ).toEqual([
      "no_ctl_history",
      "volume_fallback",
      "availability_binds",
      "feasibility_not_realistic",
      "race_created",
      "availability_seeded",
      "short_horizon",
    ]);
  });

  it("a null feasibility verdict is silent, not a warning", () => {
    expect(collectWarnings({ ...clean, feasibilityVerdict: null })).toEqual([]);
  });

  it("a ready feasibility verdict is silent, not a warning", () => {
    expect(collectWarnings({ ...clean, feasibilityVerdict: "ready" })).toEqual(
      []
    );
  });
});
