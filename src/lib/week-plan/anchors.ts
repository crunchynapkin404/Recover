/**
 * Anchors derived from the athlete's own history, for when they have not set
 * one themselves.
 *
 * Both are LOW confidence, and the running one for a reason worth stating
 * rather than assuming: nothing in `activities` distinguishes a hard effort
 * from an easy long run, so the fastest qualifying run is a FLOOR on the
 * athlete's ability, not a measurement of it. A well-trained athlete who has
 * raced nothing recently is under-anchored — and the direction of that error
 * is known and safe: demand comes out understated, never overstated.
 * `body_prefs.threshold_pace_sec_per_km` exists so the athlete can correct it.
 *
 * Pure — the caller does the database read. See volume-inputs.ts.
 */
import { canonicalSport } from "@/lib/canonical-sport";
import { thresholdPaceFromPerformance } from "@/lib/race/running-time";

export const ANCHOR_CONSTANTS = {
  /**
   * How far back to look. Wider than LEVEL_CONSTANTS.PEAK_WINDOW_WEEKS (12
   * weeks) on purpose: a rolling volume peak should be recent, but a
   * threshold is a slower-moving property and a 12-week window would miss a
   * whole off-season.
   */
  WINDOW_DAYS: 180,
  /**
   * Shortest run that anchors a threshold. Riegel is most accurate when the
   * reference is within a few multiples of the target, and a 3 km parkrun
   * extrapolated to a marathon is not.
   */
  MIN_RUN_KM: 5,
  /** Shortest swim that anchors a pace — below this, warm-up dominates. */
  MIN_SWIM_M: 400,
} as const;

export interface AnchorActivity {
  sport: string;
  distanceM: number | null;
  durationS: number | null;
}

function usable(
  a: AnchorActivity,
  discipline: string,
  minDistanceM: number
): { km: number; hours: number } | null {
  if (canonicalSport(a.sport) !== discipline) return null;
  const metres = a.distanceM ?? 0;
  const seconds = a.durationS ?? 0;
  if (metres < minDistanceM || seconds <= 0) return null;
  return { km: metres / 1000, hours: seconds / 3600 };
}

/**
 * Threshold pace in seconds per kilometre from the fastest qualifying run,
 * Riegel-converted to a one-hour reference so it enters the model on the same
 * footing as a pace the athlete typed in.
 */
export function thresholdPaceFromHistory(
  activities: AnchorActivity[]
): number | null {
  let best: number | null = null;
  for (const a of activities) {
    const u = usable(a, "Run", ANCHOR_CONSTANTS.MIN_RUN_KM * 1000);
    if (u == null) continue;
    const pace = thresholdPaceFromPerformance(u.km, u.hours);
    if (pace == null) continue;
    // Lower seconds-per-km is faster.
    if (best == null || pace < best) best = pace;
  }
  return best;
}

/**
 * Median swim pace in seconds per 100 m.
 *
 * Median rather than fastest: unlike the running anchor, a pool session is
 * already a fair reading of sustainable pace, and a median resists one sprint
 * set in a way a maximum does not.
 */
export function swimPaceFromHistory(
  activities: AnchorActivity[]
): number | null {
  const paces: number[] = [];
  for (const a of activities) {
    const u = usable(a, "Swim", ANCHOR_CONSTANTS.MIN_SWIM_M);
    if (u == null) continue;
    paces.push((u.hours * 3600) / (u.km * 10));
  }
  if (paces.length === 0) return null;
  paces.sort((x, y) => x - y);
  const mid = Math.floor(paces.length / 2);
  return paces.length % 2 === 1
    ? paces[mid]
    : (paces[mid - 1] + paces[mid]) / 2;
}
