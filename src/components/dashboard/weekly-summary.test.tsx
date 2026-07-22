import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { WeeklySummary } from "./weekly-summary";

/**
 * v0.10 Honest Load — the This Week rings previously rendered fabricated
 * fractions (hardcoded 0.7/0.8) for athletes with no real target. These
 * tests pin the hidden-when-absent behavior so the fabrication cannot
 * come back. Split out of the deleted honest-load.test.tsx (which also
 * covered the since-removed ScoreRing) during the v0.21 final review.
 */
describe("WeeklySummary rings", () => {
  const base = {
    workouts: 3,
    totalVolume: "4.5h",
    avgLoad: "55",
    streak: 0,
  };

  it("draws no rings when neither target exists", () => {
    const html = renderToString(
      <WeeklySummary {...base} ringOuter={null} ringInner={null} />
    );
    expect(html).not.toContain("<svg");
    // server-HTML puts a comment node between JSX expressions
    expect(html).toContain("Workouts");
  });

  it("draws only the ring that has a real target", () => {
    const html = renderToString(
      <WeeklySummary {...base} ringOuter={0.5} ringInner={null} />
    );
    expect(html).toContain("<svg");
    expect(html).toContain("#10b981"); // volume ring present
    expect(html).not.toContain("#3b82f6"); // load ring absent
  });

  it("draws both rings when both targets exist", () => {
    const html = renderToString(
      <WeeklySummary {...base} ringOuter={0.5} ringInner={0.9} />
    );
    expect(html).toContain("#10b981");
    expect(html).toContain("#3b82f6");
  });
});
