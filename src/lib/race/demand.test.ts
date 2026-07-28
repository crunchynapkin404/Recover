import { describe, expect, it } from "vitest";
import { eventDemand, type EventDemandInput } from "./demand";

const ATHLETE = { ftpWatts: 310, massKg: 87 };
const base: EventDemandInput = {
  eventDays: 1,
  distanceKm: null,
  elevationM: null,
  stages: [],
  overrideWeeklyHours: null,
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
    })!;
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
    })!;
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
    })!;
    const sixDays = eventDemand({
      ...base,
      eventDays: 6,
      distanceKm: 720,
      elevationM: 15000,
    })!;
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
    })!;
    const asStage = eventDemand({
      ...base,
      eventDays: 1,
      distanceKm: null,
      elevationM: null,
      stages: [{ dayNumber: 1, distanceKm: 130, elevationM: 4000 }],
    })!;
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
    })!;
    const fromTotals = eventDemand({
      ...base,
      eventDays: 2,
      distanceKm: 220,
      elevationM: 5000,
    })!;

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
    })!;
    expect(d.queenStageKnown).toBe(true);
    expect(d.queenStageHours).toBeGreaterThan(d.dailyRateHours);
  });

  it("falls back to the average day, and says so, without stages", () => {
    const d = eventDemand({
      ...base,
      eventDays: 8,
      distanceKm: 900,
      elevationM: 20000,
    })!;
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
    })!;
    expect(d.weeklyHours).toBe(14);
    expect(d.source).toBe("override");
  });

  it("returns null when there is nothing to compute from", () => {
    expect(eventDemand(base)).toBeNull();
    expect(
      eventDemand({
        ...base,
        distanceKm: 130,
        elevationM: 4000,
        ftpWatts: null,
      })
    ).toBeNull();
  });

  it("defaults mass rather than refusing when weight is unknown", () => {
    const d = eventDemand({
      ...base,
      distanceKm: 130,
      elevationM: 4000,
      massKg: null,
    });
    expect(d).not.toBeNull();
  });

  it("never divides by zero on a malformed day count", () => {
    const d = eventDemand({
      ...base,
      eventDays: 0,
      distanceKm: 130,
      elevationM: 4000,
    })!;
    expect(Number.isFinite(d.weeklyHours)).toBe(true);
    expect(d.dailyRateHours).toBeGreaterThan(0);
  });
});
