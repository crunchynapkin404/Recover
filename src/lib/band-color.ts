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
