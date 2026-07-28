import { describe, expect, it } from "vitest";
import { estimateRidingHours, ftpFractionFor } from "./riding-time";

// The calibration athlete: FTP 310W, 79kg rider + 8kg bike = 87kg total.
const ATHLETE = { ftpWatts: 310, massKg: 87 };

describe("estimateRidingHours", () => {
  it("estimates the 8-day alpine tour at roughly 50 hours", () => {
    const h = estimateRidingHours({
      distanceKm: 900,
      elevationM: 20000,
      ...ATHLETE,
    });
    expect(h).not.toBeNull();
    expect(h!).toBeGreaterThan(38);
    expect(h!).toBeLessThan(50);
  });

  it("estimates a single alpine gran fondo at roughly 6-7 hours", () => {
    const h = estimateRidingHours({
      distanceKm: 130,
      elevationM: 4000,
      ...ATHLETE,
    });
    expect(h!).toBeGreaterThan(4.5);
    expect(h!).toBeLessThan(7);
  });

  it("takes longer for the same distance with more climbing", () => {
    const flat = estimateRidingHours({
      distanceKm: 150,
      elevationM: 500,
      ...ATHLETE,
    })!;
    const hilly = estimateRidingHours({
      distanceKm: 150,
      elevationM: 3500,
      ...ATHLETE,
    })!;
    expect(hilly).toBeGreaterThan(flat);
  });

  it("takes longer for a weaker rider", () => {
    const strong = estimateRidingHours({
      distanceKm: 150,
      elevationM: 2000,
      ftpWatts: 310,
      massKg: 87,
    })!;
    const weak = estimateRidingHours({
      distanceKm: 150,
      elevationM: 2000,
      ftpWatts: 180,
      massKg: 87,
    })!;
    expect(weak).toBeGreaterThan(strong);
  });

  it("returns null rather than guessing when inputs are unusable", () => {
    expect(
      estimateRidingHours({ distanceKm: 0, elevationM: 0, ...ATHLETE })
    ).toBeNull();
    expect(
      estimateRidingHours({
        distanceKm: 100,
        elevationM: 1000,
        ftpWatts: 0,
        massKg: 87,
      })
    ).toBeNull();
  });

  it("treats negative elevation as zero, never as a time credit", () => {
    const h = estimateRidingHours({
      distanceKm: 100,
      elevationM: -500,
      ...ATHLETE,
    })!;
    const flat = estimateRidingHours({
      distanceKm: 100,
      elevationM: 0,
      ...ATHLETE,
    })!;
    expect(h).toBeCloseTo(flat, 5);
  });

  it("no longer jumps across the old 5-hour band edge", () => {
    // 114km predicted 4.985h and 116km predicted 5.424h under the step
    // function: 8.8% more time for 1.75% more distance. The response must
    // now be proportionate to the input.
    const shorter = estimateRidingHours({
      distanceKm: 114,
      elevationM: 2533,
      ...ATHLETE,
    })!;
    const longer = estimateRidingHours({
      distanceKm: 116,
      elevationM: 2578,
      ...ATHLETE,
    })!;
    expect(longer).toBeGreaterThan(shorter);
    expect(longer / shorter).toBeLessThan(1.05);
  });
});

describe("ftpFractionFor", () => {
  it("returns exactly the anchor fraction at each anchor", () => {
    expect(ftpFractionFor(3)).toBeCloseTo(0.85, 10);
    expect(ftpFractionFor(5)).toBeCloseTo(0.75, 10);
    expect(ftpFractionFor(8)).toBeCloseTo(0.68, 10);
  });

  it("is flat outside the anchor range", () => {
    expect(ftpFractionFor(0.5)).toBeCloseTo(0.85, 10);
    expect(ftpFractionFor(1)).toBeCloseTo(0.85, 10);
    expect(ftpFractionFor(20)).toBeCloseTo(0.68, 10);
    expect(ftpFractionFor(42)).toBeCloseTo(0.68, 10);
  });

  it("interpolates rather than stepping between anchors", () => {
    // Midpoint of the 3-5h span is the midpoint of 0.85 and 0.75.
    expect(ftpFractionFor(4)).toBeCloseTo(0.8, 10);
    // The old step function returned 0.75 for both of these.
    expect(ftpFractionFor(4.99)).toBeGreaterThan(ftpFractionFor(5.01));
  });

  it("never jumps at an anchor, which is the whole point", () => {
    for (const edge of [3, 5, 8]) {
      const below = ftpFractionFor(edge - 0.01);
      const above = ftpFractionFor(edge + 0.01);
      expect(Math.abs(below - above)).toBeLessThan(0.005);
    }
  });

  it("never increases with duration", () => {
    let previous = Infinity;
    for (let h = 0.5; h <= 12; h += 0.1) {
      const f = ftpFractionFor(h);
      expect(f).toBeLessThanOrEqual(previous + 1e-12);
      previous = f;
    }
  });
});
