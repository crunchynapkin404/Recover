import { describe, expect, it } from "vitest";
import { indexFromScrollTop, nearestIndex } from "./wheel-column";

describe("indexFromScrollTop", () => {
  it("rounds to the nearest item index", () => {
    expect(indexFromScrollTop(0, 40, 13)).toBe(0);
    expect(indexFromScrollTop(38, 40, 13)).toBe(1);
    expect(indexFromScrollTop(20, 40, 13)).toBe(1);
    expect(indexFromScrollTop(480, 40, 13)).toBe(12);
  });

  it("clamps to the valid range", () => {
    expect(indexFromScrollTop(-10, 40, 13)).toBe(0);
    expect(indexFromScrollTop(10000, 40, 13)).toBe(12);
  });
});

describe("nearestIndex", () => {
  it("returns the exact index when the value is a member", () => {
    expect(nearestIndex([0, 15, 30, 45], 30)).toBe(2);
  });

  it("resolves a non-member value to its closest option", () => {
    // Old data saved on the previous 5-minute step: 35 isn't a wheel
    // option, but must snap to 30 (index 2), not fall back to index 0.
    expect(nearestIndex([0, 15, 30, 45], 35)).toBe(2);
    expect(nearestIndex([0, 15, 30, 45], 8)).toBe(1); // closer to 15 than 0
  });
});
