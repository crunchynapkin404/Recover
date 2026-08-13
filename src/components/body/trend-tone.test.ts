import { describe, expect, it } from "vitest";
import { TREND_STROKE, type TrendTone } from "./trend-tone";

describe("TREND_STROKE", () => {
  it("resolves every tone to a chart token, never to a literal colour", () => {
    const tones: TrendTone[] = ["cardiac", "recovery", "output", "body"];
    for (const tone of tones) {
      expect(TREND_STROKE[tone]).toMatch(/^var\(--chart-[1-4]\)$/);
    }
  });

  it("keeps chart-5 out — it is the 'bad' tone and no trend is a verdict", () => {
    expect(Object.values(TREND_STROKE)).not.toContain("var(--chart-5)");
  });

  it("gives each tone its own token, so four trends never collapse to one hue", () => {
    expect(new Set(Object.values(TREND_STROKE)).size).toBe(4);
  });
});
