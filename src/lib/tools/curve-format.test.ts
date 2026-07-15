import { describe, expect, it } from "vitest";
import { pickCanonical, capSeries } from "./curve-format";

describe("curve thinning", () => {
  it("picks the nearest available point per canonical target", () => {
    const xs = [1, 5, 62, 290, 1250, 3500];
    const ys = [900, 750, 420, 340, 310, 290];
    const picked = pickCanonical(xs, ys, [5, 60, 300, 1200, 3600]);
    expect(picked).toEqual([
      { target: 5, x: 5, y: 750 },
      { target: 60, x: 62, y: 420 },
      { target: 300, x: 290, y: 340 },
      { target: 1200, x: 1250, y: 310 },
      { target: 3600, x: 3500, y: 290 },
    ]);
  });

  it("skips targets farther than 25% off any point", () => {
    expect(pickCanonical([60], [400], [5, 60])).toEqual([
      { target: 60, x: 60, y: 400 },
    ]);
  });

  it("caps a series by striding, keeping first and last", () => {
    const xs = Array.from({ length: 200 }, (_, i) => i);
    const ys = xs.map((x) => x * 2);
    const capped = capSeries(xs, ys, 50);
    expect(capped.x.length).toBeLessThanOrEqual(50);
    expect(capped.x[0]).toBe(0);
    expect(capped.x.at(-1)).toBe(199);
    expect(capped.y.at(-1)).toBe(398);
  });

  it("returns short series unchanged", () => {
    expect(capSeries([1, 2], [3, 4], 50)).toEqual({ x: [1, 2], y: [3, 4] });
  });
});
