import type { Band } from "@/lib/readiness";
import type { DaySlot } from "@/lib/week-plan/types";
import { isQuality } from "@/lib/week-plan/types";
import type { RecommendContext } from "./recommend";
import { LIBRARY } from "./library";
import { plannedMins } from "@/lib/week-plan/fill";

/**
 * How many days back to look for families the athlete has already ridden.
 *
 * Source: Invented — the library's own rotation avoids repeating a FAMILY,
 * and a week is the window the plan itself is built in.
 * What would raise it: nothing available. It is a judgement about variety.
 * Confidence: Low.
 */
const RECENT_FAMILY_DAYS = 7;

/** Days counted when nothing quality is on the week at all. */
const NO_QUALITY_SENTINEL = 99;

/**
 * Assemble the recommendation's inputs from a week the app has already built.
 *
 * Pure, and derives no new fact: every number here is read off `days`, which
 * the engine produced. `weekLoadFraction` uses planned MINUTES rather than
 * load, because a session the athlete has not ridden yet has no load and
 * minutes is what both the week target and the fill rung already reason in.
 */
export function recommendContextFor(
  days: DaySlot[],
  date: string,
  band: Band,
  /**
   * The week's target in minutes. NOT named `targetMins`:
   * tests/fill-wiring.test.ts guards that identifier as a fill-only concept
   * so a new fill call site cannot slip in unnoticed, and this module has
   * nothing to do with the fill rung.
   */
  weekTargetMins: number | null
): RecommendContext {
  const idx = days.findIndex((d) => d.date === date);
  const at = idx === -1 ? days.length : idx;

  // Distance back to the nearest quality session. A day with none anywhere
  // reads as "long since", which is what lets a first-ever pick be quality.
  let daysSinceQuality = NO_QUALITY_SENTINEL;
  for (let i = at - 1; i >= 0; i--) {
    if (days[i].workouts.some(isQuality)) {
      daysSinceQuality = at - i;
      break;
    }
  }

  // fill.ts's own helper, not a hand-rolled sum — tests/target-minutes-
  // wiring.test.ts guards that there is exactly one way to total a week's
  // planned minutes, and it caught this file writing a second one.
  const planned = plannedMins(days);

  const recentFamilies: string[] = [];
  for (let i = Math.max(0, at - RECENT_FAMILY_DAYS); i < at; i++) {
    for (const w of days[i].workouts) {
      // Bound to a local so the narrowing survives the property access.
      const placement = w.placement;
      // Engine-placed sessions derive their workout from a date seed and
      // store no id, so there is no family to read — guessing one would be
      // inventing it.
      if (placement.kind !== "athlete") continue;
      const lib = LIBRARY.find((x) => x.id === placement.choice.workoutId);
      if (lib) recentFamilies.push(lib.family);
    }
  }

  return {
    band,
    daysSinceQuality,
    // No target is not "wildly over target": an unknown ceiling must not
    // silently demote every hard session the athlete could pick.
    weekLoadFraction:
      weekTargetMins && weekTargetMins > 0 ? planned / weekTargetMins : 0,
    recentFamilies,
  };
}
