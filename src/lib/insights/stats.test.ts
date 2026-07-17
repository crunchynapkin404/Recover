import { describe, expect, it } from "vitest";
import {
  mean,
  percentile,
  sampleVariance,
  tCritical95,
  welchCompare,
} from "./stats";

describe("stats", () => {
  it("mean and sample variance", () => {
    expect(mean([80, 82, 84])).toBe(82);
    expect(sampleVariance([80, 82, 84])).toBe(4); // ((−2)²+0+2²)/(3−1)
    expect(sampleVariance([5])).toBe(0);
  });

  it("t-critical values: small n is honest, large n ≈ 1.96", () => {
    expect(tCritical95(1)).toBeCloseTo(12.706, 3);
    expect(tCritical95(10)).toBeCloseTo(2.228, 3);
    expect(tCritical95(2.5)).toBeCloseTo(4.303, 3); // floors to df=2
    expect(tCritical95(31)).toBe(1.96);
    expect(tCritical95(0)).toBeCloseTo(12.706, 3); // clamped
  });

  it("linear-interpolation percentile", () => {
    expect(percentile([1, 2, 3, 4], 0.75)).toBe(3.25); // idx 2.25
    expect(percentile([10], 0.75)).toBe(10);
    expect(percentile([4, 1, 3, 2], 0.75)).toBe(3.25); // unsorted input
  });

  it("welchCompare: small samples are inconclusive despite a big diff", () => {
    // a: mean 82, s²=4, n=3 → va=4/3. b: mean 72, s²=8, n=2 → vb=4.
    // se=√(16/3)≈2.309, df≈1.68→t(1)=12.706, halfWidth≈29.3 ≫ diff 10.
    const w = welchCompare([80, 82, 84], [70, 74])!;
    expect(w.diff).toBeCloseTo(10, 5);
    expect(w.halfWidth).toBeGreaterThan(29);
    expect(w.conclusive).toBe(false);
  });

  it("welchCompare: zero variance, nonzero diff is conclusive", () => {
    const w = welchCompare(Array(10).fill(80), Array(10).fill(70))!;
    expect(w.diff).toBe(10);
    expect(w.halfWidth).toBe(0);
    expect(w.conclusive).toBe(true);
  });

  it("welchCompare: zero variance, zero diff is inconclusive", () => {
    const w = welchCompare(Array(10).fill(70), Array(10).fill(70))!;
    expect(w.conclusive).toBe(false);
  });

  it("welchCompare: null when either side has fewer than 2 values", () => {
    expect(welchCompare([1], [2, 3])).toBeNull();
    expect(welchCompare([1, 2], [])).toBeNull();
  });
});
