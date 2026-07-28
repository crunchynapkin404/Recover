import { describe, expect, it } from "vitest";
import { periodize } from "@/lib/training-plan";

describe("periodize under a derived hours target", () => {
  it("is deterministic for identical inputs", () => {
    const a = periodize(9, 76.7, 4, 10, "century", ["Bike"]);
    const b = periodize(9, 76.7, 4, 10, "century", ["Bike"]);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("produces a bigger week-5 target for a bigger hours figure", () => {
    const small = periodize(9, 76.7, 4, 6, "century", ["Bike"]);
    const large = periodize(9, 76.7, 4, 12, "century", ["Bike"]);
    const w5s = small.find((b) => b.weekNumber === 5)!;
    const w5l = large.find((b) => b.weekNumber === 5)!;
    const mins = (b: typeof w5s) =>
      b.workouts.reduce((s, w) => s + w.durationMins, 0);
    expect(mins(w5l)).toBeGreaterThan(mins(w5s));
  });

  it("still marks week 4 of a 9-week plan a recovery week", () => {
    // Guards the existing periodisation while the hours input changes.
    const blocks = periodize(9, 76.7, 4, 10, "century", ["Bike"]);
    expect(blocks.find((b) => b.weekNumber === 4)!.phase).toBe("recovery");
  });
});
