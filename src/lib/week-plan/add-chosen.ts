import { MAX_SESSIONS_PER_DAY } from "@/lib/availability/types";
import { LIBRARY } from "@/lib/interval/library";
import { resolve as fitToDuration } from "@/lib/interval/flex";
import { totalSecs } from "@/lib/interval/duration";
import { PURPOSE_BY_TYPE, withPurpose } from "@/lib/training-plan";
import type { LibraryPurpose } from "@/lib/interval/types";
import type { DaySlot, ScheduledWorkout } from "./types";
import { athletePlacement } from "./placement";

/** Why a day will not take an athlete-chosen session. */
export type AddRefusal = "day_settled" | "day_full" | "past_day";

export type AddVerdict = { ok: true } | { ok: false; reason: AddRefusal };

/** Historical fact: never recomputed, and never added to either. */
const SETTLED: ReadonlySet<DaySlot["status"]> = new Set([
  "completed",
  "missed",
  "race",
]);

/**
 * Whether the athlete may put a chosen session on this day.
 *
 * Deliberately NOT a refusal: a `pre_race` rest day, and a red readiness
 * band. The athlete asked for the agency and gets it — Recover states its
 * disagreement through `keptNote` and complies. Refusing there would make
 * this feature a suggestion box.
 *
 * The UI and the server action both call this, so the affordance and the
 * write agree on one predicate rather than drifting apart.
 */
export function canAddWorkout(day: DaySlot, todayYmd: string): AddVerdict {
  if (SETTLED.has(day.status)) return { ok: false, reason: "day_settled" };
  if (day.date < todayYmd) return { ok: false, reason: "past_day" };
  if (day.workouts.length >= MAX_SESSIONS_PER_DAY)
    return { ok: false, reason: "day_full" };
  return { ok: true };
}

/** The inverse of PURPOSE_BY_TYPE, for the five purposes the library answers. */
const TYPE_BY_PURPOSE: Record<LibraryPurpose, string> = {
  recovery: "Recovery",
  aerobic_base: "Endurance",
  long: "Long",
  threshold: "Tempo",
  vo2max: "Intervals",
};

/**
 * The lengths a workout can actually be ridden at.
 *
 * A LibraryWorkout has no authored duration — flex.ts stretches one step, so
 * every workout covers a RANGE. The picker needs those bounds to offer a
 * duration control that cannot produce an unbuildable session, and the range
 * is derived by asking `resolve` rather than by re-deriving flex's arithmetic
 * here, so the two can never disagree.
 */
export function durationRangeFor(
  workoutId: string
): { min: number; max: number } | null {
  const w = LIBRARY.find((x) => x.id === workoutId);
  if (!w) return null;
  const authored = Math.round(totalSecs(w.blocks) / 60);
  let min = authored;
  let max = authored;
  // flex.ts bounds one step at ±FLEX_FRACTION of its own length, so the
  // reachable window is always within ±100% of the authored total. Walking
  // it is O(minutes) once, and asks the real resolver for every answer.
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
 * A session from a library pick, or null when the pick cannot be built.
 *
 * Null rather than three reasons, exactly as `workoutForDay` does: the caller
 * does not need to know whether the id was unknown or the length unreachable,
 * and giving it two ways to render a refusal is two ways to get it wrong.
 *
 * `description` is deliberately empty — `renderDescription` owns the sentence
 * and derives it on read. Storing one here in parallel with the steps is the
 * drift defect this repo has recorded three times.
 */
export function buildChosenSession(
  workoutId: string,
  durationMins: number,
  day: number,
  nowIso: string
): ScheduledWorkout | null {
  const w = LIBRARY.find((x) => x.id === workoutId);
  if (!w) return null;
  if (!fitToDuration(w, durationMins)) return null;

  const type = TYPE_BY_PURPOSE[w.purpose];
  // Belt and braces: a library purpose whose type does not round-trip through
  // PURPOSE_BY_TYPE would produce a session the engine reasons about wrongly.
  if (PURPOSE_BY_TYPE[type] !== w.purpose) return null;

  return withPurpose({
    day,
    sport: "Bike",
    type,
    durationMins,
    intensity: "",
    description: "",
    placement: athletePlacement({ workoutId, chosenAt: nowIso }),
  });
}
