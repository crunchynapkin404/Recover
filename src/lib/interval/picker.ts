import { LIBRARY } from "./library";
import { resolve as fitToDuration } from "./flex";
import { renderDescription } from "./render-description";
import { renderProfile, type ProfileBar } from "./render-profile";
import { totalSecs } from "./duration";
import { recommendWorkouts, type RecommendContext } from "./recommend";
import type { LibraryPurpose } from "./types";

/**
 * One row of the picker, with everything the sheet renders and nothing else.
 *
 * BUILT ON THE SERVER. LIBRARY is 103 workouts of data and `renderProfile`
 * walks every step of every one; resolving here keeps all of it out of the
 * client bundle, exactly as `workoutForDay`'s doc comment demands of the
 * surface that renders a planned day.
 */
export interface PickerWorkout {
  id: string;
  name: string;
  purpose: LibraryPurpose;
  family: string;
  /** The workout's own coaching intent, from the library. */
  why: string;
  /** Derived at `defaultMins`, never stored. */
  description: string;
  profile: ProfileBar[];
  minMins: number;
  maxMins: number;
  defaultMins: number;
  /** 0 is the strongest. The picker marks a leading group, never hides one. */
  rank: number;
  /** Why Recover would or would not choose this today. */
  recommendWhy: string;
}

/**
 * The reachable duration window for a workout, asked of `resolve` rather than
 * re-derived from flex.ts's arithmetic so the two cannot disagree.
 */
function range(workoutId: string): { min: number; max: number } | null {
  const w = LIBRARY.find((x) => x.id === workoutId);
  if (!w) return null;
  const authored = Math.round(totalSecs(w.blocks) / 60);
  let min = authored;
  let max = authored;
  for (let m = authored; m > 0; m--) {
    if (!fitToDuration(w, m)) break;
    min = m;
  }
  for (let m = authored; m <= authored * 2 + 1; m++) {
    if (!fitToDuration(w, m)) break;
    max = m;
  }
  return { min, max };
}

/**
 * The whole library, ordered for this day.
 *
 * Returns every workout. The athlete asked for the whole library, so
 * Recover's opinion is carried by `rank` and `recommendWhy` — the sheet marks
 * a recommended group at the top of ONE list rather than gating the rest
 * behind a second tap, which is the "second door" shape the IA inventory
 * already flagged elsewhere.
 */
export function pickerWorkouts(ctx: RecommendContext): PickerWorkout[] {
  const ranked = recommendWorkouts(ctx);
  const out: PickerWorkout[] = [];
  for (const r of ranked) {
    const w = LIBRARY.find((x) => x.id === r.workoutId);
    if (!w) continue;
    const span = range(w.id);
    if (!span) continue;
    const defaultMins = Math.round(totalSecs(w.blocks) / 60);
    const blocks = fitToDuration(w, defaultMins);
    if (!blocks) continue;
    out.push({
      id: w.id,
      name: w.name,
      purpose: w.purpose,
      family: w.family,
      why: w.why,
      description: renderDescription(blocks),
      profile: renderProfile(blocks),
      minMins: span.min,
      maxMins: span.max,
      defaultMins,
      rank: r.rank,
      recommendWhy: r.why,
    });
  }
  return out;
}
