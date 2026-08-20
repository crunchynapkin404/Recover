import { describe, expect, it } from "vitest";
import { periodize } from "@/lib/training-plan";

describe("periodize under a derived hours target", () => {
  it("is deterministic for identical inputs", () => {
    const a = periodize({
      weeksTotal: 9,
      startingCtl: 76.7,
      daysPerWeek: 4,
      hoursPerWeek: 10,
      sport: "Bike",
    });
    const b = periodize({
      weeksTotal: 9,
      startingCtl: 76.7,
      daysPerWeek: 4,
      hoursPerWeek: 10,
      sport: "Bike",
    });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  // Renamed from "produces a bigger week-5 target for a bigger hours
  // figure" — that name implied this pins the SKELETON (targetLoad), which
  // it does not. What it actually pins is generateWorkouts' own
  // hours-responsiveness: the `workouts` array embedded in each block scales
  // with the hours figure passed in. `rolloverWeekPlan` discards
  // `derived.workouts` entirely (see the sibling test below — targetLoad,
  // phase and targetSessions are identical regardless of hours), so this is
  // NOT coverage of the skeleton `rolloverWeekPlan` keeps.
  //
  // The behaviour is still live in production, just through a different
  // door: `materializeWeek` makes its own separate `generateWorkouts` call
  // using `hoursForMaterialize(target)` as `hoursPerWeek`
  // (src/lib/week-plan/materialize.ts:312, `effectiveHours = Math.min(
  // hoursBudget, neededHours)`), and that is what reaches the athlete's
  // actual sessions. This test exists to pin that generateWorkouts
  // responds to its `weekHours` argument at all — a precondition that path
  // relies on — not to cover the periodized skeleton.
  it("generateWorkouts scales week-5 workout minutes with the hours figure (not the skeleton — see sibling test)", () => {
    const small = periodize({
      weeksTotal: 9,
      startingCtl: 76.7,
      daysPerWeek: 4,
      hoursPerWeek: 6,
      sport: "Bike",
    });
    const large = periodize({
      weeksTotal: 9,
      startingCtl: 76.7,
      daysPerWeek: 4,
      hoursPerWeek: 12,
      sport: "Bike",
    });
    const w5s = small.find((b) => b.weekNumber === 5)!;
    const w5l = large.find((b) => b.weekNumber === 5)!;
    const mins = (b: typeof w5s) =>
      b.workouts.reduce((s, w) => s + w.durationMins, 0);
    expect(mins(w5l)).toBeGreaterThan(mins(w5s));
  });

  // A reviewer measured this exact 20x spread (2h vs 40h/week) producing
  // byte-identical targetLoad, phase and targetSessions for every week of
  // the plan. Documented here deliberately so a future reader does not
  // assume the periodized blocks track the hours figure they were called
  // with — they don't; only `workouts` (discarded by `rolloverWeekPlan`,
  // see the test above) responds to it. See the docstring on `periodize` in
  // src/lib/training-plan.ts for why this is safe: targetLoad is driven by
  // startingCtl and fixed phase multipliers, targetSessions by
  // daysPerWeek, and phase by week index alone.
  it("keeps targetLoad, phase and targetSessions identical across a 20x hours spread", () => {
    const small = periodize({
      weeksTotal: 9,
      startingCtl: 76.7,
      daysPerWeek: 4,
      hoursPerWeek: 2,
      sport: "Bike",
    });
    const large = periodize({
      weeksTotal: 9,
      startingCtl: 76.7,
      daysPerWeek: 4,
      hoursPerWeek: 40,
      sport: "Bike",
    });
    const strip = (blocks: typeof small) =>
      blocks.map(({ weekNumber, phase, targetLoad, targetSessions }) => ({
        weekNumber,
        phase,
        targetLoad,
        targetSessions,
      }));
    expect(strip(large)).toEqual(strip(small));
  });

  it("still marks week 4 of a 9-week plan a recovery week", () => {
    // Guards the existing periodisation while the hours input changes.
    const blocks = periodize({
      weeksTotal: 9,
      startingCtl: 76.7,
      daysPerWeek: 4,
      hoursPerWeek: 10,
      sport: "Bike",
    });
    expect(blocks.find((b) => b.weekNumber === 4)!.phase).toBe("recovery");
  });
});
