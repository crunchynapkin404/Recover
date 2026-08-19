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
      { weekNumber: 1, phase: "base", segment: 1 },
      { weekNumber: 2, phase: "base", segment: 1 },
      { weekNumber: 3, phase: "recovery", segment: 1 },
      { weekNumber: 4, phase: "build", segment: 1 },
    ]);

    expect(rows).toEqual([
      { segment: 1, phase: "base", weeks: 2, weekNumbers: [1, 2] },
      { segment: 1, phase: "build", weeks: 1, weekNumbers: [4] },
      { segment: 1, phase: "recovery", weeks: 1, weekNumbers: [3] },
    ]);
  });

  it("orders week numbers ascending within a row", () => {
    const rows = buildPhases([
      { weekNumber: 9, phase: "base", segment: 1 },
      { weekNumber: 2, phase: "base", segment: 1 },
    ]);
    expect(rows[0].weekNumbers).toEqual([2, 9]);
  });

  it("keeps the two arcs separate", () => {
    const rows = buildPhases([
      { weekNumber: 1, phase: "base", segment: 1 },
      { weekNumber: 2, phase: "taper", segment: 1 },
      { weekNumber: 3, phase: "recovery", segment: 1 },
      { weekNumber: 4, phase: "base", segment: 2 },
      { weekNumber: 5, phase: "taper", segment: 2 },
    ]);
    expect(rows.map((r) => [r.segment, r.phase])).toEqual([
      [1, "base"],
      [1, "taper"],
      [1, "recovery"],
      [2, "base"],
      [2, "taper"],
    ]);
  });

  it("still sums to weeksTotal for a two-arc plan", () => {
    const rows = buildPhases([
      { weekNumber: 1, phase: "base", segment: 1 },
      { weekNumber: 2, phase: "taper", segment: 1 },
      { weekNumber: 3, phase: "recovery", segment: 1 },
      { weekNumber: 4, phase: "base", segment: 2 },
      { weekNumber: 5, phase: "taper", segment: 2 },
    ]);
    expect(rows.reduce((n, r) => n + r.weeks, 0)).toBe(5);
  });

  // Mutation guard, made explicit rather than relying on the suite passing:
  // a single-race plan (every week at segment 1) must produce EXACTLY
  // today's rows plus that one added field, not a reshaped or reordered
  // list. This pins the full shape for one representative plan length
  // (16 weeks, matching this file's other periodize-driven cases), so a
  // regression in phase boundaries, week numbers, or ordering fails here
  // even though the summed-total and grouping tests above would not catch
  // every way that could go wrong.
  it("is byte-identical to today's rows for a single-race plan", () => {
    const blocks = periodize({
      weeksTotal: 16,
      startingCtl: 45,
      daysPerWeek: 5,
      hoursPerWeek: 8,
      sport: "Run",
    });
    expect(blocks.every((b) => b.segment === 1)).toBe(true);

    const rows = buildPhases(
      blocks.map((b) => ({
        weekNumber: b.weekNumber,
        phase: b.phase as PlanPhase,
        segment: b.segment,
      }))
    );

    expect(rows).toEqual([
      { segment: 1, phase: "base", weeks: 5, weekNumbers: [1, 2, 3, 5, 6] },
      { segment: 1, phase: "build", weeks: 3, weekNumbers: [7, 9, 10] },
      { segment: 1, phase: "peak", weeks: 2, weekNumbers: [12, 13] },
      { segment: 1, phase: "taper", weeks: 2, weekNumbers: [15, 16] },
      {
        segment: 1,
        phase: "recovery",
        weeks: 4,
        weekNumbers: [4, 8, 11, 14],
      },
    ]);
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
          segment: b.segment,
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
  noBridgeRoom: false,
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
        noBridgeRoom: true,
      })
    ).toEqual([
      "no_ctl_history",
      "volume_fallback",
      "availability_binds",
      "feasibility_not_realistic",
      "race_created",
      "availability_seeded",
      "short_horizon",
      "no_bridge_room",
    ]);
  });

  it("warns when there is no room to rebuild between two A-races", () => {
    // marathon -> marathon needs 14 + 21 = 35 days.
    expect(collectWarnings({ ...clean, noBridgeRoom: true })).toEqual([
      "no_bridge_room",
    ]);
  });

  it("stays silent when the gap clears the floor", () => {
    expect(collectWarnings({ ...clean, noBridgeRoom: false })).toEqual([]);
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
