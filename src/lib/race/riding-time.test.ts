import { describe, expect, it } from "vitest";
import { estimateRidingHours } from "./riding-time";

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
    expect(h!).toBeGreaterThan(45);
    expect(h!).toBeLessThan(56);
  });

  it("estimates a single alpine gran fondo at roughly 5-6 hours", () => {
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
});
