/**
 * What sport a training plan is FOR — one decision, made once.
 *
 * Distinct from `canonical-sport.ts`, which answers a different question:
 * "does this synced activity satisfy that planned session?" That module
 * translates provider vocabulary into the planner's. This one decides what
 * the PLANNER may be asked to build, which is a strictly smaller set.
 *
 * The set is exactly the three branches `generateWorkouts` has. Swim is
 * absent on purpose: there is no swim-only branch, so a `Swim` value would
 * have fallen through to running — the same defect this module exists to
 * remove, wearing a different label. `toPlanSport("Swim")` returns null and
 * the caller refuses, which is the honest outcome. (Triathlon plans DO
 * include swim sessions; see generateTriathlonWorkouts.)
 *
 * The v0.42 defect this closes: a plan for a six-day Dolomites gran fondo
 * generated 24 running sessions, because `constraints.sports` held the
 * PROVIDER's word `"Ride"`, `inferSports` returned it verbatim, and
 * `sports[0] === "Bike"` then failed a raw equality and fell through to
 * running. Nothing threw. Every test passed.
 *
 * Pure and dependency-free apart from canonicalSport, so the migration test
 * and the UI can both use it.
 */
import { canonicalSport } from "./canonical-sport";

export const PLAN_SPORTS = ["Bike", "Run", "Triathlon"] as const;
export type PlanSport = (typeof PLAN_SPORTS)[number];

/** What a human sees in the race form's dropdown. */
export const SPORT_LABEL: Record<PlanSport, string> = {
  Bike: "Cycling",
  Run: "Running",
  Triathlon: "Triathlon (swim/bike/run)",
};

function isPlanSport(value: string): value is PlanSport {
  return (PLAN_SPORTS as readonly string[]).includes(value);
}

/**
 * Any vocabulary → the planner's, or null when it cannot be placed.
 *
 * Null rather than a fallback: the caller decides whether to refuse, and
 * every caller in this codebase does. A function that guessed here would
 * put the bug back in one place instead of three.
 */
export function toPlanSport(raw: string | null | undefined): PlanSport | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  // Triathlon is not a provider discipline, so canonicalSport does not know
  // it — check it here before delegating.
  if (trimmed.toLowerCase() === "triathlon") return "Triathlon";
  const canonical = canonicalSport(trimmed);
  return isPlanSport(canonical) ? canonical : null;
}

/**
 * The sport a race type implies, or null when it implies none.
 *
 * Substring matching on a lower-cased string, because `races.race_type` is
 * free text ("GranFondo") while the plan tool's is a closed enum
 * ("gran_fondo") — the same value reaches this function spelled both ways.
 *
 * Triathlon is tested FIRST: "ironman 70.3" contains neither "marathon" nor
 * a cycling word, but "olympic_tri" must not be read as anything else, and
 * an ordering that tested running first would place "aquathlon" wrongly.
 *
 * `general_fitness` deliberately returns null — it names no sport, and
 * inventing one is exactly what this release removes.
 */
export function inferPlanSport(raceType: string): PlanSport | null {
  const rt = raceType.toLowerCase();
  if (
    rt.includes("triathlon") ||
    rt.includes("ironman") ||
    rt.includes("70.3") ||
    rt.includes("_tri") ||
    rt.includes(" tri")
  ) {
    return "Triathlon";
  }
  if (
    rt.includes("fondo") ||
    rt.includes("century") ||
    rt.includes("crit") ||
    rt.includes("cycling") ||
    rt.includes("bike")
  ) {
    return "Bike";
  }
  if (
    rt.includes("marathon") ||
    rt.includes("half") ||
    rt.includes("ultra") ||
    rt.includes("10k") ||
    rt.includes("5k") ||
    // Word-boundary, not a bare substring: `.includes("run")` also matches
    // inside "swimrun", which names no plan sport this app builds and must
    // return null rather than being read as a running race.
    /\brun\b/.test(rt)
  ) {
    return "Run";
  }
  return null;
}

/**
 * `toPlanSport`, but refuses instead of returning null.
 *
 * The error names the offending value, because the whole point of this
 * release is that a sport nobody can place must be visible rather than
 * quietly becoming a running plan.
 */
export function requirePlanSport(raw: string | null | undefined): PlanSport {
  const sport = toPlanSport(raw);
  if (sport == null) {
    throw new Error(
      `unsupported plan sport: ${JSON.stringify(raw)} — expected one of ${PLAN_SPORTS.join(", ")}`
    );
  }
  return sport;
}

/** A discipline an ACTIVITY can be, in the planner's vocabulary. */
export type PlanDiscipline = "Bike" | "Run" | "Swim";

const DISCIPLINES: Record<PlanSport, readonly PlanDiscipline[]> = {
  Bike: ["Bike"],
  Run: ["Run"],
  Triathlon: ["Swim", "Bike", "Run"],
};

/**
 * Which activity disciplines count as "this race's sport".
 *
 * A triathlon race is satisfied by a swim, a ride or a run; a gran fondo
 * only by a ride. Compare against `canonicalSport(activity.sport)`, never
 * the raw provider word — the debrief used to test
 * `["Bike"].includes("Ride")`, which is false for every cyclist who has
 * ever used this app, so a race debrief never found the athlete's own race.
 */
export function disciplinesOf(sport: PlanSport): readonly PlanDiscipline[] {
  return DISCIPLINES[sport];
}
