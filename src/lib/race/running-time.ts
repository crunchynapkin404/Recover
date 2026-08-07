/**
 * How long a running event takes this athlete — from its distance and
 * elevation, and their threshold pace.
 *
 * The running twin of `riding-time.ts`, and deliberately a different shape.
 * Cycling needs the drag equation because speed depends on power in a way no
 * single pace captures; running does not, and the published endurance model
 * for running is Riegel's, not physics. Same job, sourced to its own sport.
 *
 * Threshold pace is by definition roughly one-hour race pace, so it IS a
 * Riegel reference performance — the model needs no second input, and the
 * athlete has one number to set rather than a distance/time pair.
 *
 * Pure — no I/O, no clock.
 */
import { DEMAND_CONSTANTS as C } from "./demand-constants";

export interface RunningTimeInput {
  /** Total distance in km (summed across all days for a stage event). */
  distanceKm: number;
  /** Total elevation gain in metres. Negative values are treated as flat. */
  elevationM: number;
  /** Seconds per kilometre at threshold — roughly one-hour race pace. */
  thresholdPaceSecPerKm: number;
}

/**
 * Estimated running time in hours, or null when the inputs cannot support an
 * estimate. Null is deliberate and matches `estimateRidingHours`: a fabricated
 * duration would propagate into a training target and a feasibility verdict.
 */
export function estimateRunningHours(input: RunningTimeInput): number | null {
  const { distanceKm, thresholdPaceSecPerKm } = input;
  // Descending does not give time back in any model worth trusting — the same
  // call riding-time.ts makes, for the same reason.
  const elevationM = Math.max(0, input.elevationM);

  if (!(distanceKm > 0) || !(thresholdPaceSecPerKm > 0)) return null;

  // ITRA km-effort: ascent priced as flat distance, then the whole thing run
  // through the endurance decay as if it were flat.
  const effectiveFlatKm =
    distanceKm + elevationM / C.VERTICAL_METRES_PER_FLAT_KM;

  // The reference performance, straight out of the anchor: the distance this
  // athlete covers in one hour at threshold.
  const referenceKm = 3600 / thresholdPaceSecPerKm;

  return Math.pow(effectiveFlatKm / referenceKm, C.RIEGEL_EXPONENT);
}

/**
 * Riegel run backwards: the threshold pace implied by a performance of
 * `hours` over `distanceKm`.
 *
 * Solves `1 = hours * (D1 / distanceKm)^k` for D1 — the distance this athlete
 * would cover in one hour — then reports its pace. Used to put a
 * history-derived performance on the same footing as a stated threshold pace,
 * so the model has exactly one anchor shape rather than two.
 */
export function thresholdPaceFromPerformance(
  distanceKm: number,
  hours: number
): number | null {
  if (!(distanceKm > 0) || !(hours > 0)) return null;
  const referenceKm = distanceKm * Math.pow(1 / hours, 1 / C.RIEGEL_EXPONENT);
  if (!(referenceKm > 0)) return null;
  return 3600 / referenceKm;
}
