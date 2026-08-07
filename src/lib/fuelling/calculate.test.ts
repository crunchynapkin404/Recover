import { describe, expect, it } from "vitest";
import { calculateFuellingGuidance } from "./calculate";

describe("calculateFuellingGuidance", () => {
  it("returns high confidence when duration, intensity and mass are present", () => {
    const out = calculateFuellingGuidance({
      durationMins: 150,
      intensity: "Z4-Z5",
      type: "Intervals",
      bodyMassKg: 72,
    });

    expect(out.confidence).toBe("high");
    expect(out.intensityBand).toBe("high");
    expect(out.before.carbsG.min).toBeGreaterThanOrEqual(50);
    expect(out.during.carbsPerHourG.max).toBeGreaterThanOrEqual(60);
    expect(out.after.proteinG.min).toBeGreaterThanOrEqual(15);
  });

  it("returns medium confidence when mass is missing", () => {
    const out = calculateFuellingGuidance({
      durationMins: 90,
      intensity: "Z3",
      type: "Tempo",
      bodyMassKg: null,
    });

    expect(out.confidence).toBe("medium");
    expect(out.assumptions).toContain(
      "body mass missing; generic recovery ranges used"
    );
    expect(out.after.carbsG.min).toBe(45);
  });

  it("returns low confidence fallback when duration or intensity are missing", () => {
    const out = calculateFuellingGuidance({
      durationMins: null,
      intensity: null,
      type: null,
      bodyMassKg: null,
    });

    expect(out.confidence).toBe("low");
    expect(out.assumptions.length).toBeGreaterThanOrEqual(2);
    expect(out.before.carbsG.min).toBeGreaterThan(0);
  });
});
