import type { Purpose } from "@/lib/availability/types";
import type { Block, LibraryWorkout } from "./types";
import { LIBRARY } from "./library";
import { matchWorkout } from "./match";
import { renderDescription } from "./render-description";
import { renderProfile, type ProfileBar } from "./render-profile";

/** Everything the surface needs about a day's structured workout. */
export interface DayWorkout {
  workout: LibraryWorkout;
  blocks: Block[];
  /** Derived, never stored — the sentence and the structure cannot disagree. */
  description: string;
  profile: ProfileBar[];
}

/**
 * The one entry point the app uses: a planned session in, a rendered workout
 * or null out.
 *
 * `null` is the whole of the refusal contract as far as the surface is
 * concerned — no sport match, no purpose the library answers, or nothing that
 * fits the length, and the day simply keeps the prose and band it already had.
 * The caller does not need to know which, and giving it three reasons to
 * render differently would be three ways to get it wrong.
 *
 * CALL THIS FROM A SERVER COMPONENT. It reaches LIBRARY, thirty workouts of
 * data; resolving on the server keeps every one of them out of the client
 * bundle, and nothing here needs a browser.
 */
export function workoutForDay(
  session: { sport: string; purpose: Purpose; durationMins: number },
  date: string
): DayWorkout | null {
  const match = matchWorkout(LIBRARY, session, date);
  if (match.kind !== "matched") return null;
  return {
    workout: match.workout,
    blocks: match.blocks,
    description: renderDescription(match.blocks),
    profile: renderProfile(match.blocks),
  };
}
