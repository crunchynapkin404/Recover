/**
 * What to lift this week, given the plan's phase and the athlete's maxima.
 *
 * Pure — no db, no clock — the same shape as readiness.ts and
 * training-load.ts, so tests and the MCP tool can both call it directly.
 *
 * Every constant here is coaching convention with no comparative evidence
 * behind the specific numbers, labeled the same way plan-constants.ts labels
 * its own phase shares. See
 * docs/specs/2026-08-24-strength-training-design.md.
 */
import type { PlanPhase } from "@/lib/plan-phase";

export type Lift = "Squat" | "Bench" | "Deadlift" | "OverheadPress";

/** The big four. Deliberately fixed for v1 — see the spec's non-goals. */
export const LIFTS: readonly Lift[] = [
  "Squat",
  "Bench",
  "Deadlift",
  "OverheadPress",
];

export interface StrengthExercise {
  lift: Lift;
  sets: number;
  reps: number;
  /** Fraction of the athlete's 1RM, e.g. 0.65. */
  pctOneRm: number;
  /** pctOneRm x that lift's 1RM, rounded. null = that 1RM is unset. */
  targetLoadKg: number | null;
}

export interface OneRepMaxes {
  squatOneRmKg: number | null;
  benchOneRmKg: number | null;
  deadliftOneRmKg: number | null;
  overheadPressOneRmKg: number | null;
}

/**
 * The materialize-layer opt-in signal, from the athlete's raw bodyPrefs row
 * (or its absence). Strength is opt-in via the four Settings fields: an
 * athlete who has touched none of them — no row at all, or a row with all
 * four still null (the common case: bodyPrefs already exists for most
 * athletes, for FTP/weight/pace, well before any of them ever visits the
 * new strength fields) — must get `null` here, never an all-null
 * `OneRepMaxes` object, so `materializeWeek`'s `input.oneRms != null`
 * opt-in gate reads it as "schedule no strength at all". Any ONE lift set
 * is enough to opt in; the rest simply refuse their own load in
 * `strengthPrescription()` above.
 *
 * Takes a plain field shape rather than the drizzle `bodyPrefs` row type
 * so this file stays dependency-free (no db import) — every caller already
 * has a row shaped like this from `db.query.bodyPrefs.findFirst(...)`.
 */
export function oneRmsFromBodyPrefs(
  prefs:
    | {
        squatOneRmKg: number | null;
        benchOneRmKg: number | null;
        deadliftOneRmKg: number | null;
        overheadPressOneRmKg: number | null;
      }
    | null
    | undefined
): OneRepMaxes | null {
  if (!prefs) return null;
  const { squatOneRmKg, benchOneRmKg, deadliftOneRmKg, overheadPressOneRmKg } =
    prefs;
  if (
    squatOneRmKg == null &&
    benchOneRmKg == null &&
    deadliftOneRmKg == null &&
    overheadPressOneRmKg == null
  ) {
    return null;
  }
  return { squatOneRmKg, benchOneRmKg, deadliftOneRmKg, overheadPressOneRmKg };
}

interface PhaseRx {
  sets: number;
  reps: number;
  pctOneRm: number;
}

/**
 * Linear periodization: volume in base, intensity toward peak, maintenance
 * through taper, deload in recovery. Traditional coaching convention with no
 * head-to-head evidence for these exact figures over any others.
 * Confidence: Low.
 */
const PHASE_TABLE: Record<PlanPhase, PhaseRx> = {
  base: { sets: 4, reps: 8, pctOneRm: 0.65 },
  build: { sets: 4, reps: 5, pctOneRm: 0.75 },
  peak: { sets: 3, reps: 3, pctOneRm: 0.82 },
  taper: { sets: 2, reps: 3, pctOneRm: 0.78 },
  recovery: { sets: 2, reps: 8, pctOneRm: 0.55 },
};

/**
 * A completed strength session's load, for DISPLAY only.
 *
 * Deliberately below DURATION_TSS_PER_HOUR (40): a lift session is shorter
 * than the duration rung's hour, and this number must never read as
 * commensurate with an endurance TSS. It is never summed into CTL/ATL — see
 * training-load.ts, which returns null load for a strength activity.
 * Invented. Confidence: Low.
 */
export const STRENGTH_SESSION_LOAD = 30;

/**
 * How many strength sessions a week carries. Drops in taper so race-week
 * freshness is not spent in the gym. Coaching convention. Confidence: Low.
 */
export const STRENGTH_SESSIONS_PER_WEEK = 2;
export const STRENGTH_SESSIONS_PER_WEEK_TAPER = 1;

/**
 * Nominal duration of a big-4 session, for placement against availability
 * blocks. Matches the four lifts at working-set rest intervals. Invented.
 * Confidence: Low.
 */
export const STRENGTH_SESSION_MINS = 45;

const ONE_RM_BY_LIFT: Record<Lift, keyof OneRepMaxes> = {
  Squat: "squatOneRmKg",
  Bench: "benchOneRmKg",
  Deadlift: "deadliftOneRmKg",
  OverheadPress: "overheadPressOneRmKg",
};

/**
 * The week's prescription. Always returns all four lifts: a missing 1RM
 * refuses that lift's LOAD, not its sets and reps, and never the other
 * three lifts' targets.
 */
export function strengthPrescription(
  phase: PlanPhase,
  oneRms: OneRepMaxes | null
): StrengthExercise[] {
  const rx = PHASE_TABLE[phase];
  return LIFTS.map((lift) => {
    const max = oneRms?.[ONE_RM_BY_LIFT[lift]] ?? null;
    return {
      lift,
      sets: rx.sets,
      reps: rx.reps,
      pctOneRm: rx.pctOneRm,
      targetLoadKg: max != null ? Math.round(max * rx.pctOneRm) : null,
    };
  });
}
