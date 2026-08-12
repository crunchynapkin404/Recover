import type { Band } from "@/lib/readiness";

// Band palette from the design tokens (globals.css / README §Design tokens).
// Shared by every surface that paints a readiness band — Today's hero ring
// and Train's week-header chip — so a band never means two colours.
export const BAND_COLOR: Record<Band, string> = {
  green: "#10b981",
  amber: "#f59e0b",
  red: "#ef4444",
  calibrating: "rgba(255,255,255,0.4)",
};

// Outer glow tinted to the band — amber matches the 2a mockup exactly.
export const BAND_GLOW: Record<Band, string> = {
  green: "rgba(16,185,129,0.2)",
  amber: "rgba(245,158,11,0.2)",
  red: "rgba(239,68,68,0.2)",
  calibrating: "rgba(255,255,255,0.08)",
};

/** Band as TEXT. Governed by today-hero's contrast test — see that file. */
export const BAND_TEXT: Record<Band, string> = {
  green: "text-chart-2",
  amber: "text-chart-3",
  red: "text-chart-5",
  calibrating: "text-ink-muted",
};

/** Band as an SVG stroke. Non-text, so the 3:1 minimum applies, not 4.5:1. */
export const BAND_STROKE: Record<Band, string> = {
  green: "stroke-chart-2",
  amber: "stroke-chart-3",
  red: "stroke-chart-5",
  calibrating: "stroke-hairline",
};

/** Band as a DOT fill. Non-text, so the 3:1 minimum applies, not 4.5:1. */
export const BAND_DOT: Record<Band, string> = {
  green: "bg-chart-2",
  amber: "bg-chart-3",
  red: "bg-chart-5",
  calibrating: "bg-ink-muted",
};
