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
 * Matching on a lower-cased string, because `races.race_type` is free text
 * ("GranFondo") while the plan tool's is a closed enum ("gran_fondo") — the
 * same value reaches this function spelled both ways. `_` and `-` are
 * normalised to spaces first, so a needle can be matched as a whole word
 * regardless of which separator the caller used: `\b` does NOT fire between
 * `_` and a letter (`_` counts as a word character), so "olympic_tri" would
 * silently stop matching the moment the "tri" needle switched to
 * word-boundary form without this normalisation step.
 *
 * Short, collision-prone needles (`tri`, `run`, `crit`, `half`, `ultra`) are
 * matched at word boundaries, not as bare substrings — a bare
 * `.includes("tri")` reads "time trial" (a cycling format) as a triathlon
 * because "tri" sits inside "trial". "time trial" is genuinely ambiguous
 * (running time trials exist too), so it correctly falls through to null:
 * refusing beats guessing.
 *
 * Only `tri` gets a FULL word boundary (`/\btri\b/`). It is the only one of
 * these needles whose real-world collision *appends* letters onto the
 * needle ("trial" = "tri" + "al"), so it is the only one a trailing anchor
 * protects. `run`, `crit`, `half` and `ultra` get a LEADING boundary only
 * (`/\brun/`, `/\bcrit/`, `/\bhalf/`, `/\bultra/`) — no trailing `\b` —
 * because compound race names routinely *append* letters onto them
 * legitimately ("running", "criterium", "ultratrail") and a trailing anchor
 * would silently stop matching every one of those. `run` still needs its
 * leading anchor: without it, `.includes("run")` would also match inside
 * "swimrun", which names no plan sport this app builds and must return
 * null rather than being read as a running race — "swimrun" has no
 * boundary before "run" either (fused, no separator), so the leading
 * anchor excludes it while still matching "running" and "trail running"
 * (both have "run" at the start of a word).
 *
 * `bike` is deliberately NOT anchored at all, even though it is short. A
 * leading-only boundary (the pattern above) requires the boundary to sit
 * immediately before "bike", which holds for "bikepacking" (bike starts
 * the word) but NOT for "mountainbike" (bike ends a fused word with no
 * separator before it — "n" and "b" are both word characters, so `\b`
 * does not fire there). Anchoring `bike` on either side breaks one of
 * these two real compounds; anchoring on neither breaks neither, and
 * nothing in this codebase's vocabulary contains "bike" as an unwanted
 * substring, so plain substring matching is the correct — not merely
 * convenient — choice here, same as the long needles below.
 *
 * Long, distinctive needles (`triathlon`, `ironman`, `70.3`, `fondo`,
 * `century`, `cycling`, `marathon`) also keep plain substring matching;
 * they are not short enough to collide with anything.
 *
 * Triathlon is tested FIRST: "half ironman" contains "half", which the
 * running branch would match on its own — testing running first would
 * misread a half-iron triathlon as a running race. Testing triathlon first
 * catches "ironman" before the running branch ever sees the string.
 *
 * `general_fitness` deliberately returns null — it names no sport, and
 * inventing one is exactly what this release removes.
 */
export function inferPlanSport(raceType: string): PlanSport | null {
  const rt = raceType.toLowerCase().replace(/[_-]+/g, " ");
  if (
    rt.includes("triathlon") ||
    rt.includes("ironman") ||
    rt.includes("70.3") ||
    /\btri\b/.test(rt)
  ) {
    return "Triathlon";
  }
  if (
    rt.includes("fondo") ||
    rt.includes("century") ||
    rt.includes("cycling") ||
    rt.includes("bike") ||
    /\bcrit/.test(rt)
  ) {
    return "Bike";
  }
  if (
    rt.includes("marathon") ||
    rt.includes("10k") ||
    rt.includes("5k") ||
    // "parkrun" is a common race name in its own right and does not
    // contain "run" as a separate word, so it needs its own needle
    // alongside the word-boundary form below.
    rt.includes("parkrun") ||
    /\bhalf/.test(rt) ||
    /\bultra/.test(rt) ||
    // Leading word-boundary, not a bare substring: `.includes("run")` also
    // matches inside "swimrun", which names no plan sport this app builds
    // and must return null rather than being read as a running race. No
    // trailing boundary, so "running" and "trail running" still match.
    /\brun/.test(rt)
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
