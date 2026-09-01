import type { Purpose } from "@/lib/availability/types";

/**
 * What export writes onto a session, and the only state this feature stores.
 *
 * FOUR FIELDS, NOT TWO. `workoutId` and `exportedAt` alone cannot answer "does
 * this still fit?" — the only test available from them is re-deriving and
 * comparing ids, and re-derivation depends on the LIBRARY, which grows. Slice 2
 * shipped thirty workouts and slice 5 takes it past a hundred; every workout
 * added changes how the date seed lands, so a release that only added content
 * would re-derive a different workout for every day already exported and mark
 * them all stale at once — telling the athlete their whole calendar drifted
 * when nothing about their plan moved.
 *
 * Storing `purpose` and `durationMins` as they were makes staleness a direct
 * comparison against the session's own current values, depending on nothing
 * outside it.
 */
export interface WorkoutPin {
  workoutId: string;
  /** ISO instant. Recorded for the athlete, never compared. */
  exportedAt: string;
  purpose: Purpose;
  durationMins: number;
}

/**
 * Has the session changed since the athlete exported it?
 *
 * A pinned workout that has reached a head unit and a re-planned day that
 * disagrees with it is the failure this whole design exists to avoid: the
 * athlete finds out mid-ride. Recover keeps showing the pinned workout and
 * says it no longer fits, rather than silently swapping it.
 */
export function isPinStale(
  pin: WorkoutPin | undefined,
  now: { purpose: Purpose; durationMins: number }
): boolean {
  if (!pin) return false;
  return pin.purpose !== now.purpose || pin.durationMins !== now.durationMins;
}
