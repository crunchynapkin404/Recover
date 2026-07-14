import { describe, expect, it } from "vitest";
import {
  computeReadiness,
  sleepDurationScore,
  type ReadinessInput,
} from "./readiness";

/** 14 flat days — sd 0, mean = value. */
const flat = (v: number, n = 14) => Array(n).fill(v) as number[];
/** 14 alternating days around a midpoint. */
const alternating = (a: number, b: number, n = 14) =>
  Array.from({ length: n }, (_, i) => (i % 2 === 0 ? a : b));

const base: ReadinessInput = {
  hrv: null,
  restingHr: null,
  sleepScore: null,
  sleepSecs: null,
  ctl: null,
  atl: null,
  hrvBaseline: [],
  rhrBaseline: [],
};

describe("readiness engine (hand-computed fixtures)", () => {
  it("scores 50 per component on a perfectly flat baseline (z = 0)", () => {
    const r = computeReadiness({
      ...base,
      hrv: 60,
      restingHr: 45,
      sleepScore: 80,
      ctl: 50,
      atl: 50,
      hrvBaseline: flat(60),
      rhrBaseline: flat(45),
    });
    expect(r.components).toEqual({ hrv: 50, rhr: 50, sleep: 80, form: 50 });
    // 0.40·50 + 0.25·50 + 0.20·80 + 0.15·50 = 56
    expect(r.readiness).toBe(56);
    expect(r.band).toBe("amber");
    expect(r.tsb).toBe(0);
  });

  it("is calibrating below 14 days of both HRV and RHR history", () => {
    const r = computeReadiness({
      ...base,
      hrv: 60,
      restingHr: 45,
      sleepScore: 90,
      hrvBaseline: flat(60, 13),
      rhrBaseline: flat(45, 13),
    });
    expect(r.band).toBe("calibrating");
    expect(r.readiness).toBeNull();
    // Sleep still reported for the UI even while calibrating.
    expect(r.components.sleep).toBe(90);
  });

  it("never lets sleep+form alone masquerade as readiness", () => {
    const r = computeReadiness({
      ...base,
      sleepScore: 100,
      ctl: 60,
      atl: 40,
      hrvBaseline: flat(60), // calibrated, but today's HRV is missing
      rhrBaseline: [],
    });
    expect(r.band).toBe("calibrating");
    expect(r.readiness).toBeNull();
  });

  it("uses ln(HRV): the geometric mean of the baseline scores exactly 50", () => {
    // ln-mean of {40,90} = ln(60) → today at 60 must be z = 0.
    // An arithmetic-mean implementation (mean 65) would score below 50.
    const r = computeReadiness({
      ...base,
      hrv: 60,
      restingHr: 45,
      hrvBaseline: alternating(40, 90),
      rhrBaseline: flat(45),
    });
    expect(r.components.hrv).toBe(50);
  });

  it("clamps a strongly elevated HRV at 100", () => {
    // baseline 55/65 alternating: ln-sd ≈ 0.0867; hrv 75 → z ≈ +2.6 → clamp 100
    const r = computeReadiness({
      ...base,
      hrv: 75,
      restingHr: 45,
      hrvBaseline: alternating(55, 65),
      rhrBaseline: flat(45),
    });
    expect(r.components.hrv).toBe(100);
  });

  it("renormalizes weights when today's HRV is missing", () => {
    const r = computeReadiness({
      ...base,
      restingHr: 45,
      sleepScore: 100,
      ctl: 60,
      atl: 40, // TSB +20 → 50 + 50 = 100 → clamped to 90
      hrvBaseline: flat(60),
      rhrBaseline: flat(45),
    });
    expect(r.components).toEqual({ hrv: null, rhr: 50, sleep: 100, form: 90 });
    // (0.25·50 + 0.20·100 + 0.15·90) / 0.60 = 46/0.6 = 76.67 → 77
    expect(r.readiness).toBe(77);
    expect(r.band).toBe("green");
  });

  it("clamps the form component to [10, 90]", () => {
    const deepFatigue = computeReadiness({
      ...base,
      hrv: 60,
      ctl: 40,
      atl: 80, // TSB −40 → 50 − 100 → clamp 10
      hrvBaseline: flat(60),
      rhrBaseline: [],
    });
    expect(deepFatigue.components.form).toBe(10);
    expect(deepFatigue.tsb).toBe(-40);

    const bigTaper = computeReadiness({
      ...base,
      hrv: 60,
      ctl: 80,
      atl: 50, // TSB +30 → 125 → clamp 90
      hrvBaseline: flat(60),
      rhrBaseline: [],
    });
    expect(bigTaper.components.form).toBe(90);
  });

  it("lands in the red band on suppressed HRV, spiked RHR, short sleep", () => {
    const r = computeReadiness({
      ...base,
      hrv: 30, // far below 55–65 baseline → 0
      restingHr: 55, // far above 44–46 baseline → 0
      sleepSecs: 4 * 3600, // curve: 100 − 3.5·20 = 30
      ctl: 40,
      atl: 80, // form clamp 10
      hrvBaseline: alternating(55, 65),
      rhrBaseline: alternating(44, 46),
    });
    expect(r.components).toEqual({ hrv: 0, rhr: 0, sleep: 30, form: 10 });
    // 0.20·30 + 0.15·10 = 7.5 → 8
    expect(r.readiness).toBe(8);
    expect(r.band).toBe("red");
  });

  it("ignores non-positive values in baselines", () => {
    const r = computeReadiness({
      ...base,
      hrv: 60,
      hrvBaseline: [...flat(60, 14), 0, -5],
      rhrBaseline: [],
    });
    expect(r.components.hrv).toBe(50);
  });
});

describe("sleepDurationScore", () => {
  it("matches the hand-computed curve", () => {
    expect(sleepDurationScore(8 * 3600)).toBe(100); // plateau
    expect(sleepDurationScore(7.5 * 3600)).toBe(100); // plateau edge
    expect(sleepDurationScore(8.5 * 3600)).toBe(100); // plateau edge
    expect(sleepDurationScore(6 * 3600)).toBe(70); // 1.5h under → −30
    expect(sleepDurationScore(10 * 3600)).toBe(70); // 1.5h over → −30
    expect(sleepDurationScore(3 * 3600)).toBe(10); // 4.5h under → −90
    expect(sleepDurationScore(0.5 * 3600)).toBe(0); // floor
  });
});
