/**
 * The shape of a plan the athlete has been shown but has not accepted.
 *
 * Arithmetic first: `phases` exists so the week count reconciles on screen.
 * `periodize` substitutes recovery weeks INSIDE a phase's span, so "base 8
 * weeks" and "eight base weeks" are different numbers — the gap that produced
 * six separate confused forum posts on the competing implementation. Recovery
 * therefore gets its own row and the rows sum to weeksTotal by construction.
 *
 * Pure — no I/O, no clock.
 */

export type PlanPhase = "base" | "build" | "peak" | "taper" | "recovery";

export interface PhaseRow {
  phase: PlanPhase;
  /** Equals weekNumbers.length. Carried explicitly because it is what renders. */
  weeks: number;
  weekNumbers: number[];
}

/** Display order. Recovery sits last: it is a modifier, not a stage. */
const PHASE_ORDER: PlanPhase[] = ["base", "build", "peak", "taper", "recovery"];

export function buildPhases(
  weeks: { weekNumber: number; phase: PlanPhase }[]
): PhaseRow[] {
  const byPhase = new Map<PlanPhase, number[]>();
  for (const w of weeks) {
    const list = byPhase.get(w.phase) ?? [];
    list.push(w.weekNumber);
    byPhase.set(w.phase, list);
  }

  return PHASE_ORDER.filter((p) => byPhase.has(p)).map((phase) => {
    const weekNumbers = [...(byPhase.get(phase) ?? [])].sort((a, b) => a - b);
    return { phase, weeks: weekNumbers.length, weekNumbers };
  });
}
