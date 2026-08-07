/**
 * How long a swim leg takes this athlete, from its distance and their pace.
 *
 * Deliberately the simplest of the three models, and deliberately not a
 * Riegel: a triathlon swim leg is 0.75-3.8 km, so the duration range is
 * narrow enough that decay sits inside the anchor's own error. Swim is priced
 * ONLY as a leg inside a triathlon — it is not a plan sport, and there is no
 * swim branch in generateWorkouts to plan for it.
 *
 * Pure — no I/O, no clock.
 */

/**
 * Estimated swim time in hours, or null when the inputs cannot support an
 * estimate. Null rather than 0: a zero-hour leg would silently vanish from a
 * triathlon's total and understate the whole event.
 */
export function estimateSwimHours(
  distanceKm: number,
  paceSecPer100m: number
): number | null {
  if (!(distanceKm > 0) || !(paceSecPer100m > 0)) return null;
  const hundreds = (distanceKm * 1000) / 100;
  // No race-day adjustment: priced at the athlete's own median pace. See the
  // evidence document for why that assumption is stated rather than tuned.
  const seconds = hundreds * paceSecPer100m;
  return seconds / 3600;
}
