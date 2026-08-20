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

const run = (over: Partial<Parameters<typeof racePacing>[0]> = {}) =>
  racePacing({
    sport: "Run",
    distanceKm: 21.1,
    elevationM: 150,
    eventDays: 1,
    ftpWatts: null,
    massKg: null,
    thresholdPaceSecPerKm: 240,
    ...over,
  });

/** The Run counterpart of bikeValue — same narrowing reason. */
function runValue(r: ReturnType<typeof racePacing>) {
  if (!r.available) throw new Error(`expected available, got ${r.kind}`);
  if (r.value.sport !== "Run") throw new Error("expected a Run target");
  return { value: r.value, confidence: r.confidence, why: r.why };
}

describe("racePacing — Run", () => {
  it("targets a pace slower than threshold for a half marathon", () => {
    const { value } = runValue(run());
    expect(value.sport).toBe("Run");
    // Threshold is ~1h race pace; a half takes longer, so pace must be slower
    // (a HIGHER seconds-per-km) than the 240 anchor.
    expect(value.targetSecPerKm).toBeGreaterThan(240);
  });

  // Riegel decays pace with distance. A 10k must be paced faster than a
  // marathon off the same threshold, or the model is not being consulted.
  it("paces a 10k faster than a marathon", () => {
    const short = runValue(run({ distanceKm: 10, elevationM: 0 }));
    const long = runValue(run({ distanceKm: 42.2, elevationM: 0 }));
    expect(short.value.targetSecPerKm).toBeLessThan(long.value.targetSecPerKm);
  });

  // lowSecPerKm is the FAST end. Getting this backwards would tell an athlete
  // their easy end is their hard end, and no type would catch it.
  it("names the fast end low and the slow end high", () => {
    const { targetSecPerKm, lowSecPerKm, highSecPerKm } = runValue(run()).value;
    expect(lowSecPerKm).toBeLessThan(targetSecPerKm);
    expect(highSecPerKm).toBeGreaterThan(targetSecPerKm);
    expect(
      Math.abs(
        highSecPerKm - lowSecPerKm - 2 * targetSecPerKm * PACING_BAND_FRACTION
      )
    ).toBeLessThanOrEqual(1);
  });

  it("is medium confidence and cites Riegel", () => {
    const r = runValue(run());
    expect(r.confidence).toBe("medium");
    expect(r.why).toMatch(/Riegel/i);
  });

  it("refuses without a threshold pace", () => {
    const r = run({ thresholdPaceSecPerKm: null });
    expect(r.available).toBe(false);
    if (r.available) return;
    expect(r.kind).toBe("missing_input");
  });
});
