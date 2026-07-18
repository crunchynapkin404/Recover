import { describe, expect, it } from "vitest";
import {
  biologicalAge,
  MIN_BIOAGE_COMPONENTS,
  MAX_OFFSET_YEARS,
  type BioAgeInputs,
  type BioAgeResult,
} from "./biological-age";

function inputs(over: Partial<BioAgeInputs>): BioAgeInputs {
  return {
    chronologicalAge: 40,
    restingHr: null,
    hrvMs: null,
    sleepConsistency: null,
    vo2max: null,
    bodyFatPct: null,
    ...over,
  };
}

function assertResult(r: ReturnType<typeof biologicalAge>): BioAgeResult {
  if ("insufficient" in r) throw new Error("expected a result");
  return r;
}

describe("biologicalAge", () => {
  it("insufficient without a birth year", () => {
    const r = biologicalAge(
      inputs({
        chronologicalAge: null,
        restingHr: 55,
        hrvMs: 70,
        sleepConsistency: 90,
      })
    );
    expect("insufficient" in r).toBe(true);
    if ("insufficient" in r) expect(r.missing).toContain("Birth year");
  });

  it("insufficient below the minimum components", () => {
    const r = biologicalAge(inputs({ restingHr: 55, hrvMs: 70 }));
    expect("insufficient" in r).toBe(true);
    if ("insufficient" in r) {
      expect(r.have.length).toBe(MIN_BIOAGE_COMPONENTS - 1);
      expect(r.missing).toContain("VO₂max");
    }
  });

  it("healthy signals lower biological age below chronological", () => {
    const r = assertResult(
      biologicalAge(
        inputs({
          restingHr: 48, // below ref 60 → younger
          hrvMs: 80, // above ref 55 → younger
          sleepConsistency: 95, // above ref 75 → younger
          vo2max: 55, // above ref 42 → younger
          bodyFatPct: 12, // below ref 18 → younger
        })
      )
    );
    expect(r.deltaYears).toBeLessThan(0);
    expect(r.bioAge).toBeLessThan(40);
    expect(r.components).toHaveLength(5);
  });

  it("poor signals raise biological age above chronological", () => {
    const r = assertResult(
      biologicalAge(
        inputs({
          restingHr: 72,
          hrvMs: 30,
          sleepConsistency: 45,
        })
      )
    );
    expect(r.deltaYears).toBeGreaterThan(0);
    expect(r.bioAge).toBeGreaterThan(40);
  });

  it("clamps the total offset to the max", () => {
    const r = assertResult(
      biologicalAge(
        inputs({
          chronologicalAge: 50,
          restingHr: 100, // way high
          hrvMs: 10,
          sleepConsistency: 0,
          vo2max: 15,
          bodyFatPct: 45,
        })
      )
    );
    expect(r.deltaYears).toBeLessThanOrEqual(MAX_OFFSET_YEARS);
    expect(r.bioAge).toBeLessThanOrEqual(50 + MAX_OFFSET_YEARS);
  });

  it("never returns a biological age below 18", () => {
    const r = assertResult(
      biologicalAge(
        inputs({
          chronologicalAge: 20,
          restingHr: 40,
          hrvMs: 120,
          sleepConsistency: 100,
          vo2max: 70,
        })
      )
    );
    expect(r.bioAge).toBeGreaterThanOrEqual(18);
  });
});
