/**
 * What a Body trend measures, and therefore which chart token draws it.
 *
 * Before v0.99 slice 3 each of the 17 call sites passed its own hex pair —
 * sixteen distinct hues, none of them a token, none of them theme-aware, all
 * of them invisible to every guard in tests/. Four tones on four chart tokens
 * replaces them. The tones are families, not a legend: no two cards are ever
 * read against each other, so a repeated hue costs nothing and a per-metric
 * hue bought nothing.
 *
 * chart-5 is deliberately absent. It is the "bad" tone in this app's tone map
 * (see the token table in docs/plans/2026-08-13-v099-slice3-body.md) and none
 * of these trends is a verdict — a high resting heart rate is a reading, not
 * a failure.
 */
export type TrendTone = "cardiac" | "recovery" | "output" | "body";

export const TREND_STROKE: Record<TrendTone, string> = {
  cardiac: "var(--chart-1)",
  recovery: "var(--chart-2)",
  output: "var(--chart-3)",
  body: "var(--chart-4)",
};
