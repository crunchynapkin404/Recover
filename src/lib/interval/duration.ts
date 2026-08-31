import type { Block } from "./types";

/**
 * The authored length of a workout, in seconds, counting every repetition.
 *
 * Authored, not rendered: slice 1's matcher adjusts one flex step to hit a
 * day's exact length, and calls this on the adjusted blocks. Keeping the
 * function ignorant of that distinction is what lets it serve both.
 */
export function totalSecs(blocks: readonly Block[]): number {
  let total = 0;
  for (const b of blocks) {
    let inner = 0;
    for (const s of b.steps) inner += s.secs;
    total += inner * b.repeat;
  }
  return total;
}
