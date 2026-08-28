// Energy as fill DENSITY, one hue (plan decision 3).
//
// The spec asks for "Fill = energy … the same two-channel grammar as the day
// strip". The day strip's channels are colour (status, via STATUS_DOT) and
// shape (a notch on a hard day), and its own comment is explicit that colour
// is not available for intensity. This timeline paints no status, so it takes
// the same two channels with one hue: three densities of --accent, plus the
// strip's notch glyph on `full` alone. Energy is therefore never carried by
// colour alone, which is what makes it survive a colour-blind reading.
//
// THE DENSITIES ARE CAPPED, NOT CHOSEN BY EYE. Text sits inside these pills,
// so each composited fill must clear AA under --ink-primary in both themes.
// A solid bg-accent does not (~3.3:1 light, ~2.0:1 dark) — see
// tests/energy-fill-contrast.test.ts, which measures every value here and
// pins that failure so this cap cannot be quietly lifted.
import type { Energy } from "./types";

/** The scale as numbers, for the contrast test to compute against. */
export const ENERGY_ALPHA: Record<Energy, number> = {
  easy: 0.2,
  normal: 0.4,
  full: 0.6,
};

/**
 * The same scale as Tailwind classes. Written out as literals, never
 * assembled from ENERGY_ALPHA at runtime: Tailwind v4 only compiles classes
 * that appear as literal strings in source (see tests/type-scale-guard.test.ts
 * for the same argument), so a computed `bg-accent/${n}` would produce no CSS.
 */
export const ENERGY_FILL: Record<Energy, string> = {
  easy: "bg-accent/20",
  normal: "bg-accent/40",
  full: "bg-accent/60",
};
