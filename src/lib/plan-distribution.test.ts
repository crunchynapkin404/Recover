import { describe, expect, it } from "vitest";
import { generateWorkouts } from "./training-plan";

// ---------------------------------------------------------------------------
// v0.94.0. These fractions decide what an athlete's week physically looks
// like — how long the long run is, how a triathlete's hours divide across
// three sports — and NOTHING pinned them. Found by mutation, not by reading:
//
//   - raising the long-run share from 32% to 50% of the week passed every
//     test in the repo
//   - inverting the triathlon split entirely, from 20/40/40 to 50/30/20,
//     passed every test in the repo
//
// Only the cycling long-ride fraction had coverage, from v0.46's work. These
// tests close that gap for the other two. They assert PROPORTIONS rather than
// literal minute counts, so they survive a change to the weekly hours fixture
// while still failing on any change to the distribution itself.
// ---------------------------------------------------------------------------

/** Total prescribed minutes across every session in a generated week. */
function totalMins(ws: { durationMins: number }[]): number {
  return ws.reduce((s, w) => s + w.durationMins, 0);
}

/** Minutes prescribed for one sport within a generated week. */
function minsForSport(
  ws: { sport: string; durationMins: number }[],
  sport: string
) {
  return ws
    .filter((w) => w.sport === sport)
    .reduce((s, w) => s + w.durationMins, 0);
}

describe("run plan distribution", () => {
  // 8 hours, deliberately. RUN_LONG_FRACTION only governs BELOW the
  // crossover at 9.375 h/week — above it, `RUN_LONG_CAP_MINS` (180) clamps
  // every long run to the same value and the fraction has no effect at all.
  //
  // This is not a detail: the first version of this test used a 10-hour week
  // and could not fail. Mutating the fraction from 0.32 to 0.50 left it green,
  // because 192 and 300 both clamp to 180. The fixture has to sit where the
  // named bound is the binding one, or the test pins the clamp while claiming
  // to pin the fraction.
  const WEEK_HOURS = 8;

  it("gives the long run the documented share of the week", () => {
    // Hansons / Daniels cap the long run at 25-30% of weekly volume, which
    // read as TIME rather than distance is 30-33% — the band
    // RUN_LONG_FRACTION sits in. A regression pushing the long run to half
    // the week would be a real injury-risk change, and before this test it
    // was entirely silent.
    const week = generateWorkouts(5, WEEK_HOURS, "build", "Run");
    const longRun = week.find((w) => w.type === "Long");

    expect(longRun).toBeDefined();
    // 32% of a 480-minute week = 154, under the 180 cap. The LITERAL, not
    // `WEEK_HOURS * 60 * RUN_LONG_FRACTION` — an expectation computed from
    // the constant under test restates the implementation and moves with the
    // mutation, so it can never fail. That mistake was made here first and
    // caught by mutation; see the cap tests below for where it survived.
    expect(longRun!.durationMins).toBe(154);
    expect(longRun!.durationMins).toBeLessThan(180);

    // And it stays a minority of the prescribed week.
    expect(longRun!.durationMins).toBeLessThan(totalMins(week) / 2);
  });

  it("caps the long run at three hours however big the week gets", () => {
    // The bound that actually governs a high-volume runner: at 20 h/week the
    // fraction alone would ask for 384 minutes.
    const week = generateWorkouts(6, 20, "build", "Run");
    const longRun = week.find((w) => w.type === "Long");
    expect(longRun!.durationMins).toBe(180);
  });

  it("cuts the long run harder in a taper week", () => {
    const week = generateWorkouts(5, 12, "taper", "Run");
    const longRun = week.find((w) => w.type === "Long");
    expect(longRun!.durationMins).toBe(60);
  });
});

describe("triathlon discipline split", () => {
  // The sharpest claim in plan-distribution-constants.ts, and the one
  // documented there as Invented and NOT matching published distributions
  // (which put bike at 40-50% and run at 20-30%, against Recover's 40/40).
  // That disagreement is recorded as a finding rather than fixed in a
  // provenance release — which makes pinning the current behaviour more
  // important, not less: whoever changes it should have to change a test
  // that states what the old split was.
  it("divides the week across swim, bike and run in the documented proportions", () => {
    const week = generateWorkouts(6, 12, "build", "Triathlon");
    const total = totalMins(week);
    expect(total).toBeGreaterThan(0);

    const swim = minsForSport(week, "Swim") / total;
    const bike = minsForSport(week, "Bike") / total;
    const run = minsForSport(week, "Run") / total;

    // LITERALS, deliberately — not TRI_SPLIT.swim and friends. An expectation
    // read from the constant under test moves with the mutation and cannot
    // fail on it. The first version of this test did exactly that, and only
    // caught the inverted-split mutation by luck: rounding drift happened to
    // push the realised proportions outside tolerance. Luck is not a guard.
    //
    // Generous tolerance because sessions round to whole minutes and the
    // generator fills remaining days, so the realised split drifts a little
    // from the nominal 20/40/40.
    expect(swim).toBeCloseTo(0.2, 1);
    expect(bike).toBeCloseTo(0.4, 1);
    expect(run).toBeCloseTo(0.4, 1);
  });

  it("gives the bike at least as much of the week as the swim", () => {
    // The one ordering every published distribution agrees on, whatever the
    // exact percentages: swim gets the least. Stated separately from the
    // numbers above because it should survive a future release that
    // re-sources the split — see the TRI_SPLIT comment.
    const week = generateWorkouts(6, 12, "build", "Triathlon");
    expect(minsForSport(week, "Bike")).toBeGreaterThanOrEqual(
      minsForSport(week, "Swim")
    );
  });
});
