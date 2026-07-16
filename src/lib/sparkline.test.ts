import { describe, expect, it } from "vitest";
import { sparkPath } from "./sparkline";

/**
 * Honesty-debt fix: sparkPath used to return a horizontal line
 * ("M0 10 L100 10") when there were fewer than two real data points — a
 * visual claim of stability fabricated from nothing. An empty path is the
 * honest answer; the grid renders nothing for it.
 */
describe("sparkPath", () => {
  it("returns an empty path for an empty series", () => {
    expect(sparkPath([])).toBe("");
  });

  it("returns an empty path for a single point — one reading is not a trend", () => {
    expect(sparkPath([42])).toBe("");
  });

  it("returns an empty path when nulls leave fewer than two real points", () => {
    expect(sparkPath([null, 42, null])).toBe("");
  });

  it("never emits the fabricated flat line", () => {
    expect(sparkPath([])).not.toContain("L100 10");
  });

  it("draws a real path for two or more points", () => {
    const path = sparkPath([50, 60, 55]);
    expect(path).toMatch(/^M0\.0 /);
    expect(path).toContain("L");
    expect(path).toContain("L100.0 ");
  });

  it("skips nulls but keeps the surviving points", () => {
    expect(sparkPath([50, null, 60])).toBe(sparkPath([50, 60]));
  });

  it("maps min and max onto the fixed 2–18 y-range", () => {
    // min → y 18, max → y 2 (higher value = higher on the chart)
    expect(sparkPath([0, 100])).toBe("M0.0 18.0 L100.0 2.0");
  });
});
