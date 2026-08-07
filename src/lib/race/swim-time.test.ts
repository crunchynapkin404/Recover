import { describe, expect, it } from "vitest";
import { estimateSwimHours } from "./swim-time";

describe("estimateSwimHours", () => {
  it("prices a 3.8 km Ironman swim at a 2:00/100m pace at about 1.27 h", () => {
    // 3800 m / 100 = 38 lengths of 120 s = 4560 s = 1.2667 h.
    const hours = estimateSwimHours(3.8, 120);
    expect(hours).not.toBeNull();
    expect(hours!).toBeCloseTo(1.2667, 3);
  });

  it("scales linearly with distance", () => {
    const short = estimateSwimHours(1.9, 120)!;
    const long = estimateSwimHours(3.8, 120)!;
    expect(long).toBeCloseTo(short * 2, 6);
  });

  it("scales linearly with pace", () => {
    const fast = estimateSwimHours(1.5, 100)!;
    const slow = estimateSwimHours(1.5, 200)!;
    expect(slow).toBeCloseTo(fast * 2, 6);
  });

  it("returns null rather than zero on unusable input", () => {
    expect(estimateSwimHours(0, 120)).toBeNull();
    expect(estimateSwimHours(1.5, 0)).toBeNull();
  });
});
