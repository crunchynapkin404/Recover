import { describe, expect, it } from "vitest";
import { swimPaceFromHistory, thresholdPaceFromHistory } from "./anchors";

const run = (km: number, minutes: number) => ({
  sport: "Run",
  distanceM: km * 1000,
  durationS: minutes * 60,
});

describe("thresholdPaceFromHistory", () => {
  it("uses the fastest qualifying run, not the longest", () => {
    const pace = thresholdPaceFromHistory([
      run(30, 180), // long and slow: 6:00/km
      run(10, 45), // short and fast: 4:30/km
    ]);
    const fastOnly = thresholdPaceFromHistory([run(10, 45)]);
    expect(pace).toBeCloseTo(fastOnly!, 6);
  });

  it("ignores runs below the qualifying distance", () => {
    // A 3 km parkrun is a long Riegel extrapolation to a marathon; excluded.
    expect(thresholdPaceFromHistory([run(3, 12)])).toBeNull();
  });

  it("ignores activities that are not runs", () => {
    expect(
      thresholdPaceFromHistory([
        { sport: "Ride", distanceM: 40000, durationS: 3600 },
      ])
    ).toBeNull();
  });

  it("canonicalises the provider's word for running", () => {
    expect(
      thresholdPaceFromHistory([
        { sport: "TrailRun", distanceM: 10000, durationS: 2700 },
      ])
    ).not.toBeNull();
  });

  it("returns null with no usable history rather than guessing a pace", () => {
    expect(thresholdPaceFromHistory([])).toBeNull();
    expect(
      thresholdPaceFromHistory([
        { sport: "Run", distanceM: null, durationS: 2700 },
      ])
    ).toBeNull();
  });
});

describe("swimPaceFromHistory", () => {
  const swim = (metres: number, seconds: number) => ({
    sport: "Swim",
    distanceM: metres,
    durationS: seconds,
  });

  it("takes the median rather than the fastest", () => {
    // Medians resist one lucky sprint set in a way a max does not.
    const pace = swimPaceFromHistory([
      swim(1000, 1200), // 2:00/100m
      swim(1000, 1500), // 2:30/100m
      swim(1000, 1800), // 3:00/100m
    ]);
    expect(pace).toBeCloseTo(150, 6);
  });

  it("ignores swims below the qualifying distance", () => {
    expect(swimPaceFromHistory([swim(200, 240)])).toBeNull();
  });

  it("returns null with no usable history", () => {
    expect(swimPaceFromHistory([])).toBeNull();
  });
});
