import type { Block, LibraryWorkout } from "./types";
import { totalSecs } from "./duration";

/**
 * How far the one flexible step may move from its authored length, as a
 * fraction of that length. This is the whole tolerance of the matcher: a
 * workout fits a day exactly when its flex step can absorb the difference.
 *
 * Source: Invented — nothing in the literature bounds how far a session's
 * steady portion may stretch before it is a different session.
 * What would raise it: nothing available. It is a judgement about identity,
 * not a measurable quantity.
 * Confidence: Low.
 */
export const FLEX_FRACTION = 0.5;

/**
 * A floor under the flexed step, so a long cooldown never trims to something
 * not worth clipping in for.
 * Source: Invented — a round, convenient number.
 * Confidence: Low.
 */
export const FLEX_FLOOR_SECS = 300;

/**
 * Math.min so a step already shorter than the floor still resolves at its
 * authored length rather than being unmatchable outright.
 */
function flexLo(secs: number): number {
  return Math.min(
    secs,
    Math.max(FLEX_FLOOR_SECS, Math.round(secs * (1 - FLEX_FRACTION)))
  );
}

function flexHi(secs: number): number {
  return Math.round(secs * (1 + FLEX_FRACTION));
}

/**
 * Which step absorbs the difference between a workout's authored length and
 * the day's: the longest step in any `repeat === 1` block, ties won by the
 * LAST, which puts a cooldown ahead of an equal-length warmup.
 *
 * A step inside a repeat is never touched — the main set is what the workout
 * IS. A workout with no `repeat === 1` block therefore has nothing to flex
 * and can never be a candidate.
 *
 * AUTHORING NOTE, because this function decides the library's size: choose
 * the flex step for the span its purpose must cover, not by position. For
 * `recovery`, `aerobic_base` and `long` that is the endurance body, not the
 * warmup — see the spec's table under "Design 3". A warmup-sized flex step
 * everywhere needs 70 workouts to tile the range where 20 would do.
 *
 * Indices, not references: two steps in one workout can be the same object,
 * and slice 0 already shipped a defect from comparing hand-authored steps
 * with `!==`.
 */
export function flexRef(
  blocks: readonly Block[]
): { b: number; s: number } | null {
  let bi = -1;
  let si = -1;
  let best = -1;
  for (let b = 0; b < blocks.length; b++) {
    const block = blocks[b];
    if (block.repeat !== 1) continue;
    for (let s = 0; s < block.steps.length; s++) {
      if (block.steps[s].secs >= best) {
        best = block.steps[s].secs;
        bi = b;
        si = s;
      }
    }
  }
  return bi === -1 ? null : { b: bi, s: si };
}

/**
 * The continuous range of total durations this workout can be fitted to, in
 * seconds. Slice 2's coverage guard is the union of these across the library
 * — see the spec's "Coverage is continuous, not banded".
 */
export function flexSpanSecs(
  w: LibraryWorkout
): { lo: number; hi: number } | null {
  const ref = flexRef(w.blocks);
  if (!ref) return null;
  const flex = w.blocks[ref.b].steps[ref.s];
  const fixed = totalSecs(w.blocks) - flex.secs;
  return { lo: fixed + flexLo(flex.secs), hi: fixed + flexHi(flex.secs) };
}
