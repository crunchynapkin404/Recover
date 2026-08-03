// The fill rung. Unlike every other rung in the ladder, this one ADDS: it
// grows a session whose block gained room, then places at most one new
// session, stopping the moment the week reaches the live target.
//
// Pure — no I/O, no clock. The target and the event's queen stage are
// resolved by the caller and passed in.
import type { Purpose } from "@/lib/availability/types";
import { EASY_RUN_CAP_MINS, longRideBoundMins } from "@/lib/training-plan";
import type { DaySlot } from "./types";

/**
 * How long fill may make a session of this purpose, in this sport — or null
 * when fill must not touch it at all.
 *
 * One function, shared by both sub-steps, so growing and placing can never
 * disagree about what a session is allowed to be.
 *
 * Every bound here is one the generator already applies for that sport.
 * Fill invents no constant of its own: an unjustified duration cap is
 * precisely the defect v0.30.0 existed to remove.
 */
export function fillCeilingMins(
  purpose: Purpose,
  sport: string,
  queenStageHours: number | null
): number | null {
  // Endurance only. v0.30.0 settled this: stretching a VO2max block changes
  // what it is, so intensity is never grown and never added.
  if (purpose !== "aerobic_base" && purpose !== "long") return null;

  if (sport === "Bike") {
    // generateCyclingWorkouts bounds BOTH its long ride and its easy rides
    // by this, so fill matches the generator exactly.
    return longRideBoundMins(queenStageHours);
  }

  if (sport === "Run") {
    // Running's single-session rule is athlete-relative — exceeding your own
    // recent longest run by 10-30% raises injury risk 64% — and no such
    // model exists in this codebase yet. So fill will grow an easy run, and
    // will never create or grow a long one.
    return purpose === "aerobic_base" ? EASY_RUN_CAP_MINS : null;
  }

  // Swim, and anything else. There is no swim duration bound anywhere in
  // this codebase, and borrowing the cycling figure would be inventing one.
  return null;
}

/**
 * Every planned minute in the week, locked days included.
 *
 * A completed Monday is training the week actually contains; excluding it
 * would make fill re-add what the athlete has already done.
 */
export function plannedMins(days: DaySlot[]): number {
  return days.reduce(
    (total, d) => total + d.workouts.reduce((s, x) => s + x.durationMins, 0),
    0
  );
}

/**
 * The sport a new session should be in: the one holding the most endurance
 * minutes this week, among sports fill can actually bound.
 *
 * `inferSports` returns an unranked array — three entries for a triathlon —
 * so "the plan's primary sport" is not a well-defined thing to reach for.
 * The week itself is the evidence. When it holds no bounded endurance
 * session at all there is no evidence, and fill adds nothing rather than
 * guessing.
 *
 * Ties break toward the first sport encountered in day order, which is
 * deterministic for a given week.
 */
export function fillSport(
  days: DaySlot[],
  queenStageHours: number | null
): string | null {
  const minsBySport = new Map<string, number>();
  for (const d of days) {
    for (const x of d.workouts) {
      if (fillCeilingMins(x.purpose, x.sport, queenStageHours) == null)
        continue;
      minsBySport.set(
        x.sport,
        (minsBySport.get(x.sport) ?? 0) + x.durationMins
      );
    }
  }

  let best: string | null = null;
  let bestMins = 0;
  for (const [sport, mins] of minsBySport) {
    if (mins > bestMins) {
      best = sport;
      bestMins = mins;
    }
  }
  return best;
}
