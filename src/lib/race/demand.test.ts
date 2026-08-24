import { describe, expect, it } from "vitest";
import { eventDemand, type EventDemandInput } from "./demand";
import { estimateSwimHours } from "./swim-time";
import { triathlonLegsFor } from "./triathlon-legs";

const ATHLETE = { ftp: { watts: 310, source: "outdoor" as const }, massKg: 87 };
const base: EventDemandInput = {
  sport: "Bike",
  raceType: "gran_fondo",
  eventDays: 1,
  distanceKm: null,
  elevationM: null,
  stages: [],
  overrideWeeklyHours: null,
  expectedFinishHours: null,
  runPace: null,
  swimPace: null,
  ...ATHLETE,
};

describe("eventDemand", () => {
  it("puts the 8-day alpine tour near 16 weekly hours", () => {
    // 39.2h of riding / 2.50 = 15.7. That is MORE than the athlete believes
    // they can manage (they estimated 9-12h) — deliberately. The ceiling in
    // weeklyTargetHours cuts it to what their chronic load supports, and the
    // gap is the finding. Do not tune the constants to close it here.
    const d = eventDemand({
      ...base,
      eventDays: 8,
      distanceKm: 900,
      elevationM: 20000,
    });
    expect(d.available).toBe(true);
    if (!d.available) return;
    expect(d.weeklyHours).toBeGreaterThan(15);
    expect(d.weeklyHours).toBeLessThan(19);
    expect(d.dailyRateHours).toBeGreaterThan(4.5);
    expect(d.dailyRateHours).toBeLessThan(8);
  });

  it("puts a single alpine gran fondo inside the published 8-12h band", () => {
    // 6.6h / 0.60 = 10.9 h/week. Published intermediate century and gran fondo
    // plans run 8-12 h/week, and this lands inside that band without being
    // fitted to it — only the two endpoint ratios were fitted.
    const d = eventDemand({
      ...base,
      eventDays: 1,
      distanceKm: 130,
      elevationM: 4000,
    });
    expect(d.available).toBe(true);
    if (!d.available) return;
    expect(d.weeklyHours).toBeGreaterThan(8);
    expect(d.weeklyHours).toBeLessThan(13);
  });

  it("asks MORE for a longer event of the same daily rate", () => {
    // The defect this formula replaced: averaging over days made a bigger
    // event ask for LESS. Total load must drive the number.
    const oneDay = eventDemand({
      ...base,
      eventDays: 1,
      distanceKm: 120,
      elevationM: 2500,
    });
    const sixDays = eventDemand({
      ...base,
      eventDays: 6,
      distanceKm: 720,
      elevationM: 15000,
    });
    expect(oneDay.available).toBe(true);
    expect(sixDays.available).toBe(true);
    if (!oneDay.available || !sixDays.available) return;
    expect(sixDays.weeklyHours).toBeGreaterThan(oneDay.weeklyHours);
  });

  it("treats a one-day event as days=1, not a special case", () => {
    // Same total riding, expressed two ways. A 1-day event must run the exact
    // same arithmetic as a multi-day one.
    const oneDay = eventDemand({
      ...base,
      eventDays: 1,
      distanceKm: 130,
      elevationM: 4000,
    });
    const asStage = eventDemand({
      ...base,
      eventDays: 1,
      distanceKm: null,
      elevationM: null,
      stages: [{ dayNumber: 1, distanceKm: 130, elevationM: 4000 }],
    });
    expect(oneDay.available).toBe(true);
    expect(asStage.available).toBe(true);
    if (!oneDay.available || !asStage.available) return;
    expect(asStage.weeklyHours).toBeCloseTo(oneDay.weeklyHours, 5);
  });

  it("agrees whether the days are given as stages or as totals", () => {
    const d = eventDemand({
      ...base,
      eventDays: 2,
      distanceKm: null,
      elevationM: null,
      stages: [
        { dayNumber: 1, distanceKm: 100, elevationM: 2000 },
        { dayNumber: 2, distanceKm: 120, elevationM: 3000 },
      ],
    });
    const fromTotals = eventDemand({
      ...base,
      eventDays: 2,
      distanceKm: 220,
      elevationM: 5000,
    });
    expect(d.available).toBe(true);
    expect(fromTotals.available).toBe(true);
    if (!d.available || !fromTotals.available) return;

    // Both paths now price per DAY — the stage loop uses the real stages, the
    // totals path uses the average day — so they agree closely. They are not
    // identical: unequal stages cost slightly more than their average.
    //
    // This assertion failed before Task 13 and is restored deliberately. The
    // original plan asserted it, Task 3 had to overturn it because the model
    // priced the two paths on different fatigue bands, and making the model
    // coherent has made it true again.
    expect(d.totalHours).toBeCloseTo(fromTotals.totalHours, 1);
  });

  it("reports the queen stage as the hardest day when stages are known", () => {
    const d = eventDemand({
      ...base,
      eventDays: 2,
      distanceKm: null,
      elevationM: null,
      stages: [
        { dayNumber: 1, distanceKm: 60, elevationM: 400 },
        { dayNumber: 2, distanceKm: 160, elevationM: 4200 },
      ],
    });
    expect(d.available).toBe(true);
    if (!d.available) return;
    expect(d.queenStageKnown).toBe(true);
    expect(d.queenStageHours).toBeGreaterThan(d.dailyRateHours);
  });

  it("falls back to the average day, and says so, without stages", () => {
    const d = eventDemand({
      ...base,
      eventDays: 8,
      distanceKm: 900,
      elevationM: 20000,
    });
    expect(d.available).toBe(true);
    if (!d.available) return;
    expect(d.queenStageKnown).toBe(false);
    expect(d.queenStageHours).toBeCloseTo(d.dailyRateHours, 5);
  });

  it("lets the athlete's override win outright", () => {
    const d = eventDemand({
      ...base,
      eventDays: 8,
      distanceKm: 900,
      elevationM: 20000,
      overrideWeeklyHours: 14,
    });
    expect(d.available).toBe(true);
    if (!d.available) return;
    expect(d.weeklyHours).toBe(14);
    expect(d.source).toBe("override");
  });

  it("refuses when there is nothing to compute from", () => {
    const noDistance = eventDemand(base);
    expect(noDistance.available).toBe(false);
    if (noDistance.available) return;
    expect(noDistance.reason).toBe("no_distance");

    const noFtp = eventDemand({
      ...base,
      distanceKm: 130,
      elevationM: 4000,
      ftp: null,
    });
    expect(noFtp.available).toBe(false);
    if (noFtp.available) return;
    expect(noFtp.reason).toBe("no_cycling_anchor");
  });

  it("defaults mass rather than refusing when weight is unknown", () => {
    const d = eventDemand({
      ...base,
      distanceKm: 130,
      elevationM: 4000,
      massKg: null,
    });
    expect(d.available).toBe(true);
  });

  // Final-review Finding 4: the `usable` filter used to admit a stage with
  // elevation but no distance, then silently drop it two lines later
  // (estimateRidingHours requires distanceKm > 0 and returns null for it).
  // `days` — both the sum's implicit day-count and the ratio() divisor —
  // stayed the full eventDays regardless, understating weekly demand.
  it("excludes a stage with elevation but no distance from the usable total, rather than pricing it as zero", () => {
    const withElevationOnlyStage = eventDemand({
      ...base,
      eventDays: 2,
      distanceKm: null,
      elevationM: null,
      stages: [
        { dayNumber: 1, distanceKm: 100, elevationM: 1500 },
        // Known climbing, unknown distance — reachable straight from the
        // race form: stagesForSubmit emits a row whenever EITHER field is
        // filled.
        { dayNumber: 2, distanceKm: null, elevationM: 1500 },
      ],
    });
    const singleStageOnly = eventDemand({
      ...base,
      eventDays: 2,
      distanceKm: null,
      elevationM: null,
      stages: [{ dayNumber: 1, distanceKm: 100, elevationM: 1500 }],
    });
    expect(withElevationOnlyStage.available).toBe(true);
    expect(singleStageOnly.available).toBe(true);
    if (!withElevationOnlyStage.available || !singleStageOnly.available) return;
    // The elevation-only day must not contribute anything — totalHours (and
    // therefore weeklyHours) must come from day 1 alone, exactly as if day
    // 2 had never been submitted at all.
    expect(withElevationOnlyStage.totalHours).toBeCloseTo(
      singleStageOnly.totalHours,
      5
    );
  });

  it("marks the queen stage unknown when the usable stages do not cover every event day", () => {
    // The exact scenario from the finding: an 8-day tour where the athlete
    // entered climbing for all 8 days but distance for only 6.
    const knownDays = Array.from({ length: 6 }, (_, i) => ({
      dayNumber: i + 1,
      distanceKm: 90,
      elevationM: 1200,
    }));
    const elevationOnlyDays = [7, 8].map((dayNumber) => ({
      dayNumber,
      distanceKm: null,
      elevationM: 1200,
    }));
    const d = eventDemand({
      ...base,
      eventDays: 8,
      distanceKm: null,
      elevationM: null,
      stages: [...knownDays, ...elevationOnlyDays],
    });
    expect(d.available).toBe(true);
    if (!d.available) return;
    // Partial coverage must not claim EventReadiness's "known hardest day"
    // confidence — the 2 unpriced days mean the total (and therefore
    // dailyRateHours) already understates demand, so the "reasoning from an
    // average day" caveat must stay on.
    expect(d.queenStageKnown).toBe(false);
    // Sanity: still prices off the 6 known stages, not zero.
    expect(d.totalHours).toBeGreaterThan(0);
  });

  it("still marks the queen stage known when the usable stages cover every event day", () => {
    // Regression guard: the coverage check must not always fail. Every one
    // of eventDays' worth of stages is fully usable here.
    const d = eventDemand({
      ...base,
      eventDays: 3,
      distanceKm: null,
      elevationM: null,
      stages: [
        { dayNumber: 1, distanceKm: 80, elevationM: 1000 },
        { dayNumber: 2, distanceKm: 90, elevationM: 1200 },
        { dayNumber: 3, distanceKm: 100, elevationM: 1400 },
      ],
    });
    expect(d.available).toBe(true);
    if (!d.available) return;
    expect(d.queenStageKnown).toBe(true);
  });

  it("never divides by zero on a malformed day count", () => {
    const d = eventDemand({
      ...base,
      eventDays: 0,
      distanceKm: 130,
      elevationM: 4000,
    });
    expect(d.available).toBe(true);
    if (!d.available) return;
    expect(Number.isFinite(d.weeklyHours)).toBe(true);
    expect(d.dailyRateHours).toBeGreaterThan(0);
  });
});

describe("eventDemand dispatches on sport", () => {
  const RUNNER = {
    sport: "Run" as const,
    raceType: "marathon",
    eventDays: 1,
    distanceKm: 42.2,
    elevationM: 0,
    stages: [],
    overrideWeeklyHours: null,
    expectedFinishHours: null,
    ftp: { watts: 310, source: "outdoor" as const },
    massKg: 83,
    runPace: { secPerKm: 300, athleteSet: true },
    swimPace: null,
  };

  it("prices a marathon as a run even when the athlete has an FTP", () => {
    // This is F3. Before v0.46 this returned ~1.2 h of CYCLING against a real
    // 3-4 h run — understated by a factor of three, silently.
    const result = eventDemand(RUNNER);
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.totalHours).toBeGreaterThan(3.5);
    expect(result.totalHours).toBeLessThan(4.0);
  });

  it("refuses a run with no pace anchor instead of falling back to the FTP", () => {
    const result = eventDemand({ ...RUNNER, runPace: null });
    expect(result.available).toBe(false);
    if (result.available) return;
    expect(result.reason).toBe("no_running_anchor");
  });

  it("sums three legs for a triathlon", () => {
    const result = eventDemand({
      ...RUNNER,
      sport: "Triathlon",
      raceType: "ironman",
      distanceKm: 226,
      swimPace: { secPer100m: 120, athleteSet: true },
    });
    expect(result.available).toBe(true);
    if (!result.available) return;
    // 1.2667 h swim + 5.5912 h bike + 3.7923 h run = 10.6502 h total (these
    // legs at this athlete's anchors). The (9, 17) range this test used to
    // assert was wide enough that dropping the swim leg entirely (9.38h)
    // still passed it. This range is tight around the true total and clears
    // every wrong-implementation total below by at least half an hour:
    //   swim dropped   ~9.38h (below 10.3)
    //   bike dropped   ~5.06h (below 10.3)
    //   run dropped    ~6.86h (below 10.3)
    //   swim doubled  ~11.92h (above 11.0)
    expect(result.totalHours).toBeGreaterThan(10.3);
    expect(result.totalHours).toBeLessThan(11.0);
  });

  it("moves the total by exactly what the swim leg's pace implies", () => {
    // Behavioural pin for the same finding: an implementation that silently
    // ignores swimPace (e.g. drops swimHours from the sum) would produce the
    // SAME total for two races that differ only in swimPace, since neither
    // the bike nor the run leg reads it. Pricing the identical Ironman twice
    // with different swimPace values and requiring the totals to differ by
    // exactly the swim leg's own delta cannot be satisfied by such a bug.
    const legs = triathlonLegsFor("ironman");
    if (legs == null) throw new Error("ironman legs missing from fixture");

    const fasterSwim = eventDemand({
      ...RUNNER,
      sport: "Triathlon",
      raceType: "ironman",
      distanceKm: 226,
      swimPace: { secPer100m: 90, athleteSet: true },
    });
    const slowerSwim = eventDemand({
      ...RUNNER,
      sport: "Triathlon",
      raceType: "ironman",
      distanceKm: 226,
      swimPace: { secPer100m: 150, athleteSet: true },
    });
    expect(fasterSwim.available).toBe(true);
    expect(slowerSwim.available).toBe(true);
    if (!fasterSwim.available || !slowerSwim.available) return;

    const expectedDiff =
      estimateSwimHours(legs.swimKm, 150)! -
      estimateSwimHours(legs.swimKm, 90)!;
    expect(slowerSwim.totalHours - fasterSwim.totalHours).toBeCloseTo(
      expectedDiff,
      10
    );
  });

  it("refuses a triathlon whose format has no known leg distances", () => {
    const result = eventDemand({
      ...RUNNER,
      sport: "Triathlon",
      raceType: "club champs relay",
      distanceKm: 100,
      swimPace: { secPer100m: 120, athleteSet: true },
    });
    expect(result.available).toBe(false);
    if (result.available) return;
    expect(result.reason).toBe("unknown_triathlon_format");
  });

  it("refuses a triathlon it cannot price the swim leg of", () => {
    // No partial pricing: a dropped leg would understate the whole event.
    const result = eventDemand({
      ...RUNNER,
      sport: "Triathlon",
      raceType: "ironman",
      distanceKm: 226,
      swimPace: null,
    });
    expect(result.available).toBe(false);
    if (result.available) return;
    expect(result.reason).toBe("no_swim_anchor");
  });

  it("attributes a triathlon's stated elevation to the bike leg", () => {
    const flat = eventDemand({
      ...RUNNER,
      sport: "Triathlon",
      raceType: "ironman",
      distanceKm: 226,
      elevationM: 0,
      swimPace: { secPer100m: 120, athleteSet: true },
    });
    const hilly = eventDemand({
      ...RUNNER,
      sport: "Triathlon",
      raceType: "ironman",
      distanceKm: 226,
      elevationM: 2000,
      swimPace: { secPer100m: 120, athleteSet: true },
    });
    expect(flat.available && hilly.available).toBe(true);
    if (!flat.available || !hilly.available) return;
    expect(hilly.totalHours).toBeGreaterThan(flat.totalHours);
  });
});

describe("eventDemand reports its confidence", () => {
  const BASE = {
    sport: "Run" as const,
    raceType: "marathon",
    eventDays: 1,
    distanceKm: 42.2,
    elevationM: 0,
    stages: [],
    overrideWeeklyHours: null,
    expectedFinishHours: null,
    ftp: null,
    massKg: 83,
    runPace: { secPerKm: 300, athleteSet: true },
    swimPace: null,
  };

  it("is high when the athlete stated their finish time", () => {
    const result = eventDemand({ ...BASE, expectedFinishHours: 3.75 });
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.confidence).toBe("high");
    expect(result.totalHours).toBe(3.75);
  });

  it("uses the stated time even with no anchor at all", () => {
    // This is the cold-start path: a first-time athlete has no history, but
    // does know what they are targeting.
    const result = eventDemand({
      ...BASE,
      runPace: null,
      expectedFinishHours: 4.5,
    });
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.totalHours).toBe(4.5);
  });

  it("is medium when every anchor used was set by the athlete", () => {
    const result = eventDemand(BASE);
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.confidence).toBe("medium");
  });

  it("is low when any anchor used was derived rather than set", () => {
    const result = eventDemand({
      ...BASE,
      runPace: { secPerKm: 300, athleteSet: false },
    });
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.confidence).toBe("low");
  });

  it("is low, and names the indoor anchor, when the FTP used was indoor", () => {
    const result = eventDemand({
      ...BASE,
      sport: "Bike",
      ftp: { watts: 235, source: "indoor" },
      runPace: null,
    });
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.confidence).toBe("low");
    expect(result.confidenceReason).toMatch(/indoor/i);
  });

  it("does not call a synced FTP 'indoor'", () => {
    const result = eventDemand({
      ...BASE,
      sport: "Bike",
      ftp: { watts: 250, source: "synced" },
      runPace: null,
    });
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.confidence).toBe("low");
    expect(result.confidenceReason).not.toMatch(/indoor/i);
  });

  // LATENT, same reasoning as "downgrades a fully anchored triathlon to low
  // confidence" below: swimPace.athleteSet: true is production-unreachable
  // (no athlete-set swim pace exists anywhere in this codebase), but pinning
  // it here is the only way to exercise weakestOfTriathlonAnchors() actually
  // landing on rank 1 ("indoor") as the MAX across all three anchors, rather
  // than only ever seeing rank 0 or rank 2. Without this, a swapped rank or
  // an off-by-one in FTP_SOURCE_BY_RANK would go undetected.
  it("names the indoor anchor when it is the weakest across a triathlon's three legs", () => {
    const result = eventDemand({
      ...BASE,
      sport: "Triathlon",
      raceType: "ironman",
      distanceKm: 226,
      ftp: { watts: 235, source: "indoor" },
      runPace: { secPerKm: 300, athleteSet: true },
      swimPace: { secPer100m: 120, athleteSet: true },
    });
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.confidenceReason).toMatch(/indoor/i);
  });

  it("takes the weakest anchor across a triathlon's three legs", () => {
    const result = eventDemand({
      ...BASE,
      sport: "Triathlon",
      raceType: "ironman",
      distanceKm: 226,
      ftp: { watts: 310, source: "outdoor" as const },
      runPace: { secPerKm: 300, athleteSet: true },
      swimPace: { secPer100m: 120, athleteSet: false },
    });
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.confidence).toBe("low");
  });

  // The sentence a real triathlete actually reads, which until v0.88.0 had no
  // test at all and was wrong: it told them to "set your thresholds in
  // Settings for a sharper figure". There is no athlete-set swim pace in this
  // codebase, so a triathlon's confidence is pinned at "low" no matter what
  // they set — the advice named a fix that could not work. This pins the
  // corrected claim: it may still nudge toward FTP and threshold pace, which
  // genuinely sharpen the bike and run legs, but it must name the swim as the
  // anchor that is always derived rather than promise a better rating.
  it("tells a triathlete the swim is always the derived anchor", () => {
    const result = eventDemand({
      ...BASE,
      sport: "Triathlon",
      raceType: "ironman",
      distanceKm: 226,
      ftp: { watts: 310, source: "outdoor" as const },
      runPace: { secPerKm: 300, athleteSet: true },
      swimPace: { secPer100m: 120, athleteSet: false },
    });
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.confidenceReason).toMatch(/swim/i);
    expect(result.confidenceReason).not.toMatch(/sharper figure/i);
  });

  it("downgrades a fully anchored triathlon to low confidence", () => {
    const result = eventDemand({
      ...BASE,
      sport: "Triathlon",
      raceType: "ironman",
      distanceKm: 226,
      ftp: { watts: 310, source: "outdoor" as const },
      runPace: { secPerKm: 300, athleteSet: true },
      swimPace: { secPer100m: 120, athleteSet: true },
    });
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.confidence).toBe("low");
    expect(result.confidenceReason).toContain("downgraded");
  });

  // Pins the boundary of the downgrade, not just its effect: a stated finish
  // time must stay "high" even for a fully anchored triathlon. The downgrade
  // only applies when confidence would otherwise be "medium" (all anchors
  // athlete-set); once the athlete has told us the time, anchor interaction
  // between legs is irrelevant.
  it("does not downgrade a triathlon when the athlete stated their finish time", () => {
    const result = eventDemand({
      ...BASE,
      sport: "Triathlon",
      raceType: "ironman",
      distanceKm: 226,
      expectedFinishHours: 11,
      ftp: { watts: 310, source: "outdoor" as const },
      runPace: { secPerKm: 300, athleteSet: true },
      swimPace: { secPer100m: 120, athleteSet: true },
    });
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.confidence).toBe("high");
  });

  it("always carries a non-empty reason sentence", () => {
    for (const input of [
      BASE,
      { ...BASE, expectedFinishHours: 3.75 },
      { ...BASE, runPace: { secPerKm: 300, athleteSet: false } },
    ]) {
      const result = eventDemand(input);
      expect(result.available).toBe(true);
      if (!result.available) continue;
      expect(result.confidenceReason.length).toBeGreaterThan(0);
    }
  });
});

/**
 * v0.46 freeze. This release must not move one decimal of the cycling path —
 * the reporting athlete is a cyclist, and every figure they see today is
 * correct. These are the pre-v0.46 outputs, recorded before the refactor.
 *
 * If one of these fails, the refactor changed cycling behaviour. Do NOT
 * update the expected numbers: find what moved.
 */
describe("cycling demand is unchanged by v0.46", () => {
  const GRAN_FONDO = {
    sport: "Bike" as const,
    raceType: "gran_fondo",
    eventDays: 1,
    distanceKm: 130,
    elevationM: 4000,
    stages: [],
    overrideWeeklyHours: null,
    expectedFinishHours: null,
    ftp: { watts: 310, source: "outdoor" as const },
    massKg: 83,
    runPace: null,
    swimPace: null,
  };

  it("prices a 130km/4000m fondo exactly as it did before", () => {
    const result = eventDemand({ ...GRAN_FONDO });
    expect(result.available).toBe(true);
    if (!result.available) return;
    // Recorded from main@cca6707 before the refactor — see Step 2.
    const EXPECTED_TOTAL_HOURS = 6.337242282842961;
    const EXPECTED_WEEKLY_HOURS = 10.562070471404937;
    const EXPECTED_QUEEN_HOURS = 6.337242282842961;
    expect(result.totalHours).toBeCloseTo(EXPECTED_TOTAL_HOURS, 10);
    expect(result.weeklyHours).toBeCloseTo(EXPECTED_WEEKLY_HOURS, 10);
    expect(result.queenStageHours).toBeCloseTo(EXPECTED_QUEEN_HOURS, 10);
    expect(result.queenStageKnown).toBe(false);
    expect(result.source).toBe("computed");
  });
});
