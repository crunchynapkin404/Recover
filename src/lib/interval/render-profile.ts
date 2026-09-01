import type { Block } from "./types";
import { totalSecs } from "./duration";

/**
 * One drawn bar of the interval profile. `x` and `w` are fractions of the
 * whole workout (0–1), so the caller scales them to whatever width it has;
 * `lo`/`hi` stay in %FTP, because the vertical scale is a zone axis the
 * component owns rather than something this module should guess at.
 */
export interface ProfileBar {
  x: number;
  w: number;
  lo: number;
  hi: number;
  ramp?: true;
}

/**
 * The in-app interval shape, as geometry rather than as SVG.
 *
 * GEOMETRY, NOT MARKUP, deliberately: `src/lib/interval/` is a pure module
 * with a guard that keeps it callable from a test and from the MCP surface,
 * and JSX here would make it neither. The component that draws these bars is
 * the only part that needs React.
 *
 * REPEATS ARE UNROLLED, the same choice renderZwo makes and for the same
 * reason: a repeat drawn once would show a 75-minute workout as 25 minutes of
 * bars, which is a picture of a different session.
 */
export function renderProfile(blocks: readonly Block[]): ProfileBar[] {
  const total = totalSecs(blocks);
  if (total <= 0) return [];

  const bars: ProfileBar[] = [];
  let elapsed = 0;
  for (const b of blocks) {
    for (let i = 0; i < b.repeat; i++) {
      for (const s of b.steps) {
        bars.push({
          x: elapsed / total,
          w: s.secs / total,
          lo: s.lo,
          hi: s.hi,
          ...(s.ramp ? { ramp: true as const } : {}),
        });
        elapsed += s.secs;
      }
    }
  }
  return bars;
}
