import { describe, expect, it } from "vitest";
import {
  estimateRunningHours,
  thresholdPaceFromPerformance,
} from "./running-time";

describe("estimateRunningHours", () => {
  it("prices a flat marathon for a 4:00/km threshold runner at close to 3h", () => {
    // 240 s/km threshold => a 15 km reference hour. Riegel to 42.2 km.
    const hours = estimateRunningHours({
      distanceKm: 42.2,
      elevationM: 0,
      thresholdPaceSecPerKm: 240,
    });
    expect(hours).not.toBeNull();
    expect(hours!).toBeGreaterThan(2.8);
    expect(hours!).toBeLessThan(3.2);
  });

  it("prices the same marathon slower for a slower runner", () => {
    const fast = estimateRunningHours({
      distanceKm: 42.2,
      elevationM: 0,
      thresholdPaceSecPerKm: 240,
    })!;
    const slow = estimateRunningHours({
      distanceKm: 42.2,
      elevationM: 0,
      thresholdPaceSecPerKm: 300,
    })!;
    expect(slow).toBeGreaterThan(fast);
    // 5:00/km threshold => a 12 km reference hour => roughly 3h45-3h50.
    expect(slow).toBeGreaterThan(3.6);
    expect(slow).toBeLessThan(4.0);
  });

  it("charges ascent as flat distance at 100 m per km", () => {
    const flat = estimateRunningHours({
      distanceKm: 42.2,
      elevationM: 0,
      thresholdPaceSecPerKm: 300,
    })!;
    const hilly = estimateRunningHours({
      distanceKm: 42.2,
      elevationM: 1000,
      thresholdPaceSecPerKm: 300,
    })!;
    const equivalent = estimateRunningHours({
      distanceKm: 52.2,
      elevationM: 0,
      thresholdPaceSecPerKm: 300,
    })!;
    expect(hilly).toBeGreaterThan(flat);
    // 1000 m of ascent is exactly 10 km of flat, by definition of the constant.
    expect(hilly).toBeCloseTo(equivalent, 6);
  });

  it("ignores descent rather than giving time back", () => {
    const withDescent = estimateRunningHours({
      distanceKm: 21.1,
      elevationM: -500,
      thresholdPaceSecPerKm: 270,
    })!;
    const flat = estimateRunningHours({
      distanceKm: 21.1,
      elevationM: 0,
      thresholdPaceSecPerKm: 270,
    })!;
    expect(withDescent).toBeCloseTo(flat, 6);
  });

  it("returns null rather than a fabricated duration on unusable input", () => {
    expect(
      estimateRunningHours({
        distanceKm: 0,
        elevationM: 0,
        thresholdPaceSecPerKm: 240,
      })
    ).toBeNull();
    expect(
      estimateRunningHours({
        distanceKm: 10,
        elevationM: 0,
        thresholdPaceSecPerKm: 0,
      })
    ).toBeNull();
  });
});

describe("thresholdPaceFromPerformance", () => {
  it("round-trips a one-hour performance to its own pace", () => {
    // 15 km in exactly 1 h IS the threshold reference, so the pace is 240 s/km.
    expect(thresholdPaceFromPerformance(15, 1)).toBeCloseTo(240, 6);
  });

  it("returns a threshold pace slower than the pace of a shorter effort", () => {
    // 10 km in 45 min is 270 s/km. Threshold sits at a longer distance, so
    // the threshold pace must be SLOWER (a larger number) than 270.
    const pace = thresholdPaceFromPerformance(10, 0.75);
    expect(pace).not.toBeNull();
    expect(pace!).toBeGreaterThan(270);
    expect(pace!).toBeLessThan(285);
  });

  it("is the inverse of estimateRunningHours on flat ground", () => {
    const pace = thresholdPaceFromPerformance(10, 0.75)!;
    const backToTen = estimateRunningHours({
      distanceKm: 10,
      elevationM: 0,
      thresholdPaceSecPerKm: pace,
    })!;
    expect(backToTen).toBeCloseTo(0.75, 6);
  });

  it("returns null on unusable input", () => {
    expect(thresholdPaceFromPerformance(0, 1)).toBeNull();
    expect(thresholdPaceFromPerformance(10, 0)).toBeNull();
  });
});
