import { describe, it, expect } from "vitest";
import { pickerWorkouts } from "./picker";
import { LIBRARY } from "./library";
import type { RecommendContext } from "./recommend";

const base: RecommendContext = {
  band: "green",
  daysSinceQuality: 3,
  weekLoadFraction: 0.5,
  recentFamilies: [],
};

describe("pickerWorkouts", () => {
  it("returns the whole library, never a shortlist", () => {
    expect(pickerWorkouts(base)).toHaveLength(LIBRARY.length);
  });

  it("comes back in recommendation order", () => {
    const ranks = pickerWorkouts(base).map((w) => w.rank);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it("gives every row a buildable duration window", () => {
    for (const w of pickerWorkouts(base)) {
      expect(w.minMins).toBeLessThanOrEqual(w.defaultMins);
      expect(w.maxMins).toBeGreaterThanOrEqual(w.defaultMins);
    }
  });

  it("derives a description and a profile for every row", () => {
    for (const w of pickerWorkouts(base)) {
      expect(w.description.length).toBeGreaterThan(0);
      expect(w.profile.length).toBeGreaterThan(0);
    }
  });

  it("never says watts — targets are always % of FTP", () => {
    const text = pickerWorkouts(base)
      .flatMap((w) => [w.description, w.why, w.recommendWhy])
      .join(" ");
    expect(/watt/i.test(text)).toBe(false);
  });

  it("carries every family the library has, so the family filter is complete", () => {
    const shown = new Set(pickerWorkouts(base).map((w) => w.family));
    const all = new Set(LIBRARY.map((w) => w.family));
    expect(shown).toEqual(all);
  });
});
