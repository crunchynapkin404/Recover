import { describe, expect, it } from "vitest";
import { buildPhases, type PlanPhase } from "./plan-preview";
import { periodize } from "./training-plan";

describe("buildPhases", () => {
  it("gives recovery its own row rather than folding it into a phase", () => {
    const rows = buildPhases([
      { weekNumber: 1, phase: "base" },
      { weekNumber: 2, phase: "base" },
      { weekNumber: 3, phase: "recovery" },
      { weekNumber: 4, phase: "build" },
    ]);

    expect(rows).toEqual([
      { phase: "base", weeks: 2, weekNumbers: [1, 2] },
      { phase: "build", weeks: 1, weekNumbers: [4] },
      { phase: "recovery", weeks: 1, weekNumbers: [3] },
    ]);
  });

  it("orders week numbers ascending within a row", () => {
    const rows = buildPhases([
      { weekNumber: 9, phase: "base" },
      { weekNumber: 2, phase: "base" },
    ]);
    expect(rows[0].weekNumbers).toEqual([2, 9]);
  });

  // The property the athlete actually checks on screen.
  it.each([1, 2, 4, 8, 12, 16, 20, 24, 32, 40, 52])(
    "rows sum to weeksTotal for a %i-week plan",
    (weeksTotal) => {
      const blocks = periodize(weeksTotal, 45, 5, 8, "Bike");
      const rows = buildPhases(
        blocks.map((b) => ({
          weekNumber: b.weekNumber,
          phase: b.phase as PlanPhase,
        }))
      );

      const summed = rows.reduce((s, r) => s + r.weeks, 0);
      expect(summed).toBe(weeksTotal);

      const seen = rows.flatMap((r) => r.weekNumbers).sort((a, b) => a - b);
      expect(seen).toEqual(Array.from({ length: weeksTotal }, (_, i) => i + 1));
    }
  );
});
