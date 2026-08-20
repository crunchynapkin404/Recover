import { describe, expect, it } from "vitest";
import { racePacing, PACING_BAND_FRACTION } from "./pacing";
import { ftpFractionFor } from "./riding-time";

const bike = (over: Partial<Parameters<typeof racePacing>[0]> = {}) =>
  racePacing({
    sport: "Bike",
    distanceKm: 90,
    elevationM: 900,
    eventDays: 1,
    ftpWatts: 250,
    massKg: 75,
    thresholdPaceSecPerKm: null,
    ...over,
  });

/**
 * Narrows a result to an available Bike target. `expect(...).toBe("Bike")`
 * asserts at runtime but does not narrow the union for TypeScript, so every
 * property access below it fails `tsc --noEmit` while vitest passes — the
 * typecheck and the test runner disagreeing about the same line.
 */
function bikeValue(r: ReturnType<typeof racePacing>) {
  if (!r.available) throw new Error(`expected available, got ${r.kind}`);
  if (r.value.sport !== "Bike") throw new Error("expected a Bike target");
  return { value: r.value, confidence: r.confidence, why: r.why };
}

describe("racePacing — Bike", () => {
  it("targets a share of FTP, not FTP itself", () => {
    const { value } = bikeValue(bike());
    expect(value.sport).toBe("Bike");
    expect(value.targetWatts).toBeLessThan(250);
    expect(value.targetWatts).toBeGreaterThan(150);
  });

  // THE MUTATION THIS FILE EXISTS FOR. The likely defect is reading
  // INITIAL_FTP_FRACTION (0.75, the pre-iteration guess) instead of
  // ftpFractionFor(hours). A ~5h event resolves near 0.75, so a 5h fixture
  // CANNOT tell those apart — docs/RELEASING.md step 3 names exactly this
  // failure. These two sit where the values differ by 0.10 and 0.07.
  it("uses the resolved fraction, not the initial guess — short event", () => {
    const { value } = bikeValue(bike({ distanceKm: 55, elevationM: 300 }));
    expect(value.hours).toBeLessThan(3.5);
    expect(value.ftpFraction).toBeGreaterThan(0.8);
    expect(value.ftpFraction).toBe(ftpFractionFor(value.hours));
  });

  it("uses the resolved fraction, not the initial guess — long event", () => {
    const { value } = bikeValue(bike({ distanceKm: 210, elevationM: 3500 }));
    expect(value.hours).toBeGreaterThan(8);
    expect(value.ftpFraction).toBeCloseTo(0.68, 5);
    expect(value.ftpFraction).toBe(ftpFractionFor(value.hours));
  });

  it("brackets the target with a symmetric band", () => {
    const { targetWatts, lowWatts, highWatts } = bikeValue(bike()).value;
    expect(lowWatts).toBeLessThan(targetWatts);
    expect(highWatts).toBeGreaterThan(targetWatts);
    expect(targetWatts - lowWatts).toBeCloseTo(highWatts - targetWatts, 0);
    // Within 1 W, not exact: both ends are rounded to whole watts, which can
    // shave up to 1 W off the width. Whole watts is the right output — no
    // power meter shows tenths — so the tolerance belongs here, not a
    // fractional target in the implementation.
    expect(
      Math.abs(highWatts - lowWatts - 2 * targetWatts * PACING_BAND_FRACTION)
    ).toBeLessThanOrEqual(1);
  });

  it("reports low confidence past the 8h anchor, and says why", () => {
    const r = bikeValue(bike({ distanceKm: 210, elevationM: 3500 }));
    expect(r.confidence).toBe("low");
    expect(r.why).toMatch(/8 ?h|published/i);
  });

  it("reports medium confidence inside the anchors", () => {
    expect(bikeValue(bike()).confidence).toBe("medium");
  });
});
