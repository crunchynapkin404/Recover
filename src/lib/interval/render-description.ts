import type { Block, Step } from "./types";
import { totalSecs } from "./duration";

const mins = (secs: number): number => Math.round(secs / 60);

/**
 * The intensity of a run of steps, as one target. A single step reads as
 * authored; several read as the span they cover, low of the lows to high of
 * the highs. En dash, matching the app's prose — the icu syntax uses a hyphen.
 */
function span(steps: readonly Step[]): string {
  const lo = Math.min(...steps.map((s) => s.lo));
  const hi = Math.max(...steps.map((s) => s.hi));
  return lo === hi ? `${lo}% FTP` : `${lo}–${hi}% FTP`;
}

/**
 * The human-readable line for a day carrying a library workout.
 *
 * DERIVED, never stored alongside the steps. `PlannedWorkout.description` is
 * hand-written prose today (training-plan.ts:979); for a library day this
 * replaces it, so the sentence and the structure cannot disagree. The spec
 * names that failure: "the same class of defect as v0.122.0's duplicated
 * event count".
 *
 * Describe the MAIN SET — the block with the highest repeat, ties to the
 * longest — because that is what the session is. Within it THE RECOVERY IS
 * THE LAST STEP, and only when its `hi` is below the block's peak. Everything
 * before it is the work body.
 *
 * That rule, rather than "the highest step is the work and the rest is
 * recovery", because an over-under is authored as an unrolled body inside one
 * repeat: peak-step logic reads its five non-peak work steps as rest and
 * reports three times the recovery that exists, while renderIcu renders the
 * same workout correctly. A work body holding an interior rest is described
 * by its span instead of being taken apart — vague is recoverable, wrong is
 * not, and the profile and the icu text are where per-step detail lives.
 *
 * Selection is by INDEX, never reference equality: a hoisted `const REST`
 * used twice in one block is two steps.
 */
export function renderDescription(blocks: readonly Block[]): string {
  const main = [...blocks]
    .filter((b) => b.repeat > 1 && b.steps.length > 0)
    .sort((a, b) => b.repeat - a.repeat || totalSecs([b]) - totalSecs([a]))[0];

  if (!main) {
    const all = blocks.flatMap((b) => b.steps);
    // No steps is not a workout. The caller keeps its own description.
    if (all.length === 0) return "";
    return `${mins(totalSecs(blocks))} min at ${span(all)}`;
  }

  const peak = Math.max(...main.steps.map((s) => s.hi));
  const last = main.steps[main.steps.length - 1];
  const hasRecovery = main.steps.length > 1 && last.hi < peak;
  const work = hasRecovery ? main.steps.slice(0, -1) : main.steps;

  const workSecs = work.reduce((t, s) => t + s.secs, 0);
  const head = `${main.repeat} × ${mins(workSecs)} min at ${span(work)}`;
  return hasRecovery ? `${head}, ${mins(last.secs)} min recovery` : head;
}
