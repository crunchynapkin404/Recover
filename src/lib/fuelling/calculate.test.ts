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

// ---------------------------------------------------------------------------
// v0.94.0. The assertions above pin FLOORS, not values —
// `toBeGreaterThanOrEqual(60)` is satisfied by 60 and equally by 75. That was
// proven by mutation, not by reading: raising the long-session during-carb
// ceiling from 60 to 75 g/h changed real athlete-facing nutrition advice and
// every test above still passed.
//
// These pin the numbers themselves. They exist because `fuelling-constants.ts`
// now attaches a published source to each figure, and a citation guarding a
// value no test can hold is decoration. If one of these fails, the question is
// whether the SOURCE changed — not whether to update the expected number.
// ---------------------------------------------------------------------------
describe("fuelling figures are pinned to their documented sources", () => {
  const moderate = { intensity: "Z2", type: "Endurance" } as const;

  it("keeps during-session carbs inside the cited per-duration guidance", () => {
    // Jeukendrup: small amounts under ~1h, ~30 g/h for 1-2h, ~60 g/h for 2-3h.
    const short = calculateFuellingGuidance({
      ...moderate,
      durationMins: 45,
      bodyMassKg: 70,
    });
    expect(short.during.carbsPerHourG).toEqual({ min: 0, max: 20 });

    const medium = calculateFuellingGuidance({
      ...moderate,
      durationMins: 90,
      bodyMassKg: 70,
    });
    expect(medium.during.carbsPerHourG).toEqual({ min: 30, max: 45 });

    const long = calculateFuellingGuidance({
      ...moderate,
      durationMins: 240,
      bodyMassKg: 70,
    });
    expect(long.during.carbsPerHourG).toEqual({ min: 45, max: 60 });
  });

  it("tops out at 75 g/h — the 90 ceiling is not the binding bound", () => {
    // Pins the maximum the model can ACTUALLY produce, which is not the
    // documented 90 g/h ceiling. The longest, hardest session gives the long
    // band's 60 plus the high-intensity uplift of 15 = 75, and nothing can
    // exceed that, so DURING_CARBS_MAX_G_PER_HOUR never binds.
    //
    // Written this way because the obvious assertion —
    // `toBeLessThanOrEqual(90)` — is vacuous. It passed when the ceiling was
    // mutated from 90 to 200, since 75 is under both. That is the
    // fixture-lets-another-bound-bind-first trap, caught by mutation here
    // rather than by reading.
    const hard = calculateFuellingGuidance({
      durationMins: 300,
      intensity: "Z5",
      type: "Intervals",
      bodyMassKg: 70,
    });
    expect(hard.during.carbsPerHourG.max).toBe(75);
  });

  it("scales post-session carbs by the cited g/kg factors", () => {
    // >=1.2 g/kg/h maximises glycogen repletion; <=0.8 is sub-optimal. A long
    // session reaches the optimum, a short one deliberately does not.
    const long = calculateFuellingGuidance({
      ...moderate,
      durationMins: 240,
      bodyMassKg: 70,
    });
    // 1.0-1.2 g/kg of 70 kg = 70-84, rounded to the nearest 5.
    expect(long.after.carbsG).toEqual({ min: 70, max: 85 });

    const short = calculateFuellingGuidance({
      ...moderate,
      durationMins: 45,
      bodyMassKg: 70,
    });
    // 0.6-0.8 g/kg of 70 kg = 42-56, rounded to the nearest 5.
    expect(short.after.carbsG).toEqual({ min: 40, max: 55 });
  });

  it("scales post-session protein by the cited co-ingestion range", () => {
    // 0.25-0.35 g/kg, sitting at the documented 0.3-0.4 g/kg/h co-ingestion
    // band — the addition that matters most when carbs are sub-optimal.
    const out = calculateFuellingGuidance({
      ...moderate,
      durationMins: 90,
      bodyMassKg: 80,
    });
    expect(out.after.proteinG).toEqual({ min: 20, max: 30 });
  });

  it("falls back to the SHORT band when duration is unknown", () => {
    // The conservative direction: the short band recommends the least
    // during-session carbohydrate, so an unknown session cannot produce an
    // over-feeding recommendation. Confidence drops to low and the assumption
    // is stated, so the athlete is told rather than handed a measured-looking
    // number.
    const out = calculateFuellingGuidance({
      durationMins: null,
      intensity: "Z2",
      type: "Endurance",
      bodyMassKg: 70,
    });
    expect(out.during.carbsPerHourG).toEqual({ min: 0, max: 20 });
    expect(out.confidence).toBe("low");
    expect(out.assumptions).toContain(
      "duration missing; conservative fallback used"
    );
  });
});
