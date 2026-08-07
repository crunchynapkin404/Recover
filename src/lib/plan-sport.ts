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
 * Strips everything but letters, digits and dots, and lower-cases.
 *
 * This collapses every separator variant of the same race name onto one
 * key — `"gran_fondo"`, `"GranFondo"` and `"gran fondo"` all normalise to
 * `"granfondo"` — while keeping `"70.3"` intact (the dot is meaningful:
 * it is part of the race's actual name, not a separator).
 *
 * Exported since v0.46: the triathlon leg table is keyed by this function's
 * output too, so free-text `races.race_type` and the plan tool's closed enum
 * must collapse onto one key or a triathlon prices as nothing at all. That is
 * what finally gives the audit's F7 real weight — before this, two spellings
 * produced only an odd plan title.
 */
export function normaliseRaceType(raceType: string): string {
  return raceType.toLowerCase().replace(/[^a-z0-9.]/g, "");
}

/**
 * Exact lookup table, keyed by `normaliseRaceType` output.
 *
 * Covers every value of the plan tool's closed 13-value raceType enum that
 * names a sport (all but `general_fitness`, which names none), plus a
 * conservative set of additional real-world spellings seen in free text.
 * Nothing containing "swim" is in here as a Run or Bike entry — Swim is not
 * a plan sport, and the whole point of this table is to stop guessing one
 * for it.
 */
export const RACE_TYPE_SPORT: Record<string, PlanSport> = {
  // --- closed enum: Run ---
  marathon: "Run",
  halfmarathon: "Run",
  "10k": "Run",
  "5k": "Run",
  ultra: "Run",
  // --- closed enum: Triathlon ---
  ironman: "Triathlon",
  "70.3": "Triathlon",
  olympictri: "Triathlon",
  sprinttri: "Triathlon",
  olympictriathlon: "Triathlon",
  sprinttriathlon: "Triathlon",
  // --- closed enum: Bike ---
  granfondo: "Bike",
  century: "Bike",
  crit: "Bike",

  // --- additional real spellings, conservative ---
  criterium: "Bike",
  ultramarathon: "Run",
  halfironman: "Triathlon",
  triathlon: "Triathlon",
  parkrun: "Run",
};

/**
 * The sport a race type implies, or null when it implies none.
 *
 * This is an exact lookup against `RACE_TYPE_SPORT`, not inference: the
 * input is normalised with `normaliseRaceType` and looked up directly. A
 * miss returns null. There is no substring or regex matching left, on
 * purpose — three separate review rounds each found a race type that a
 * heuristic matcher placed confidently and wrongly:
 *
 *   - "time trial" matched inside " tri" and returned Triathlon.
 *   - "bikepacking", "running" and "ultratrail" tripped word-boundary
 *     anchors added to fix the above, and returned null.
 *   - "10k open water swim" matched the "10k" needle and returned Run —
 *     while Swim is deliberately not a plan sport, and "10k marathon swim"
 *     is a real Olympic event. Each fix moved the collision; none removed
 *     it.
 *
 * A lookup table cannot have that failure mode: it either contains the
 * normalised string or it does not. The plan tool's raceType is a closed
 * 13-value enum at the tool boundary, and this table contains every value
 * of it that names a sport, so that caller always gets a real answer. Free
 * text (the race form's pre-fill) is best-effort by design — an
 * unrecognised spelling returns null, which there means "leave the
 * dropdown alone", a safe outcome because the athlete sees and can correct
 * it.
 */
export function inferPlanSport(raceType: string): PlanSport | null {
  const key = normaliseRaceType(raceType);
  return RACE_TYPE_SPORT[key] ?? null;
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
