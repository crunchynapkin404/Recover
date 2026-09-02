import type { Purpose } from "@/lib/availability/types";
import type { Block, LibraryWorkout } from "./types";
import { LIBRARY } from "./library";
import { matchWorkout } from "./match";
import { renderDescription } from "./render-description";
import { renderProfile, type ProfileBar } from "./render-profile";
import { resolve as fitToDuration } from "./flex";
import type { WorkoutPin } from "./pin";
import { reconcileBand } from "./zone-band";

/** Everything the surface needs about a day's structured workout. */
export interface DayWorkout {
  workout: LibraryWorkout;
  blocks: Block[];
  /** Derived, never stored — the sentence and the structure cannot disagree. */
  description: string;
  profile: ProfileBar[];
  /**
   * The day's own `intensity` label, widened when the chosen workout goes
   * above it — see zone-band.ts. Derived HERE rather than in the component so
   * the band and the workout it describes have one owner and cannot be
   * assembled two different ways on two surfaces, which is the failure
   * `docs/specs/2026-08-11-display-derived-figures-ownership-design.md`
   * exists to prevent. Equal to the planned label whenever the workout stays
   * inside it, which is the common case.
   */
  band: string;
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
  session: {
    sport: string;
    purpose: Purpose;
    durationMins: number;
    /** The planner's own label for the day. Optional: callers that predate
     *  the band lived without it, and an absent one simply yields "". */
    intensity?: string;
    pin?: WorkoutPin;
  },
  date: string
): DayWorkout | null {
  // A PINNED SESSION RENDERS WHAT WAS SENT, not what would be chosen now.
  // Once a workout is on the athlete's intervals.icu calendar it syncs to
  // their head unit, so re-deriving here would let Recover show one session
  // while the device holds another — discovered mid-ride, which is the exact
  // failure the pin exists to prevent. It renders at the length it was
  // exported at, because that is the length the device has; whether the day
  // has since moved is what `isPinStale` answers, and the surface says so.
  const pinned = session.pin
    ? LIBRARY.find((w) => w.id === session.pin!.workoutId)
    : undefined;
  if (pinned) {
    const blocks = fitToDuration(pinned, session.pin!.durationMins);
    // A pinned workout that no longer fits its own pinned length cannot
    // happen from data this app writes, but the library is hand-authored and
    // ids are stable: falling through to a fresh match is better than
    // rendering nothing.
    if (blocks) {
      return {
        workout: pinned,
        blocks,
        description: renderDescription(blocks),
        profile: renderProfile(blocks),
        band: reconcileBand(session.intensity ?? "", blocks),
      };
    }
  }

  const match = matchWorkout(LIBRARY, session, date);
  if (match.kind !== "matched") return null;
  return {
    workout: match.workout,
    blocks: match.blocks,
    description: renderDescription(match.blocks),
    profile: renderProfile(match.blocks),
    band: reconcileBand(session.intensity ?? "", match.blocks),
  };
}
