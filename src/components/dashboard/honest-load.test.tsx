import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { ScoreRing } from "./score-ring";
import { StrainBudget } from "./strain-budget";
import { WeeklySummary } from "./weekly-summary";

/**
 * v0.10 Honest Load — the Recovery/Strain rings and the This Week rings
 * previously rendered fabricated numbers (`?? 0` ctl/atl, hardcoded
 * 0.7/0.8 fractions) for athletes with no load data. These tests pin the
 * calibrating/hidden states so the fabrication cannot come back.
 */

describe("ScoreRing calibrating", () => {
  it("shows a dash and an honest aria label instead of a number", () => {
    const html = renderToString(
      <ScoreRing
        value={0}
        label="Recovery"
        color="#10b981"
        size="sm"
        calibrating
      />
    );
    expect(html).toContain("—");
    expect(html).toContain("Recovery: calibrating");
    expect(html).not.toContain("out of 100");
  });

  it("still renders real values when not calibrating", () => {
    const html = renderToString(
      <ScoreRing value={72} label="Recovery" color="#10b981" size="sm" />
    );
    expect(html).toContain("72");
    expect(html).toContain("Recovery: 72 out of 100");
  });
});

describe("StrainBudget calibrating", () => {
  it("renders the calibrating note instead of a full empty budget", () => {
    const html = renderToString(
      <StrainBudget used={0} total={21} calibrating />
    );
    expect(html).toContain("Calibrating");
    expect(html).not.toContain("remaining");
  });

  it("renders the budget bar when honest numbers exist", () => {
    const html = renderToString(<StrainBudget used={5.8} total={21} />);
    expect(html).toContain("remaining");
    expect(html).toContain("15.2");
  });
});

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
