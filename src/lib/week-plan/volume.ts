/**
 * This week's training-hours target.
 *
 *   raw     = min(race demand, measured ceiling)
 *   target  = clamp(max(raw, floor), ..ceiling)   // floor first, ceiling wins
 *   planned = min(target, availability)
 *
 * Availability is a CEILING, never a target — the same rule JOIN states
 * explicitly. Letting an empty Saturday raise the number would mean a free
 * weekend overrides a recovery week and the missed-week restart. The fix for
 * "I offered twelve hours and got five" is a correct demand figure plus saying
 * out loud when the ceiling binds, which `shortfall` carries.
 *
 * Floor vs. ceiling ordering: the floor is applied first (never prescribe
 * less than maintenance), but the ceiling always wins a direct conflict — it
 * is the acute:chronic workload safe-zone bound, and prescribing above it is
 * the one outcome in this module that can injure someone. A floor that lands
 * above the ceiling means the athlete's own recent peak is the binding
 * constraint, not the floor.
 *
 * Pure — no I/O, no clock.
 */

export interface VolumeInput {
  /** From the event demand model. null when no event has a distance yet. */
  raceDemandHours: number | null;
  /** From the athlete's rolling peak. null when there is too little history. */
  ceilingHours: number | null;
  /**
   * Never prescribe less than this. The demand model is volume-only, so a
   * criterium reads as almost no demand (2.1 h/week for an athlete who trains
   * 9) and prescribing it would be a DETRAINING plan. Detraining research sets
   * the level: a 70% volume reduction with intensity maintained preserves
   * VO2max, and 50-75% of normal volume shows no aerobic loss.
   * MAINTENANCE_FLOOR × rolling peak; null when there is no measured peak.
   */
  floorHours: number | null;
  /** This week's resolved availability, in hours. */
  availabilityHours: number;
  /** `constraints.hoursPerWeek` — the pre-existing behaviour. */
  fallbackHours: number;
}

export interface VolumeResult {
  hours: number;
  /** Which input bound the result; drives the legibility surface. */
  source: "race" | "ceiling" | "floor" | "availability" | "fallback";
  shortfall: { wantedHours: number; offeredHours: number } | null;
}

export function weeklyTargetHours(input: VolumeInput): VolumeResult {
  const availability = Math.max(0, input.availabilityHours);
  const fallback = Math.max(0, input.fallbackHours);

  let target: number;
  let source: VolumeResult["source"];

  // A null ceiling SUPPRESSES race demand rather than being bypassed.
  //
  // Writing this as `min(demand, ceiling ?? Infinity)` would hand a brand-new
  // athlete who logs an alpine tour ~11h/week on no evidence at all — the
  // largest injury risk in this design, aimed at precisely the athlete least
  // able to absorb it. With no measured ceiling we fall back to the plan's own
  // figure and let the shortfall line explain why. The maintenance floor is
  // itself derived from the same rolling-peak history as the ceiling, so it
  // does not get a say here either: no measured capacity signal means no
  // floor and no race-driven target, full stop.
  if (input.ceilingHours == null || input.raceDemandHours == null) {
    target = fallback;
    source = "fallback";
  } else {
    if (input.raceDemandHours <= input.ceilingHours) {
      target = input.raceDemandHours;
      source = "race";
    } else {
      target = input.ceilingHours;
      source = "ceiling";
    }

    // Floor first: never prescribe less than maintenance, even though the
    // demand model itself only asked for a couple of hours.
    if (input.floorHours != null && input.floorHours > target) {
      target = input.floorHours;
      source = "floor";
    }

    // ...but the ceiling wins any conflict that leaves. A floor pulled above
    // the ceiling is the athlete's own recent peak overriding the floor
    // heuristic, not license to exceed the safe-zone bound.
    if (target > input.ceilingHours) {
      target = input.ceilingHours;
      source = "ceiling";
    }
  }

  if (availability < target) {
    return {
      hours: availability,
      source: "availability",
      shortfall: { wantedHours: target, offeredHours: availability },
    };
  }

  return { hours: target, source, shortfall: null };
}

/**
 * The hours figure `materializeWeek` must receive: the target BEFORE the
 * availability clamp.
 *
 * `weeklyTargetHours` applies availability last, and `materializeWeek` applies
 * it again from the same `dayMins` sum — lowering `effectiveLoad` and pushing
 * the adjustment that tells the athlete why their week shrank. Handing it an
 * already-clamped number makes that branch unreachable: the week keeps its
 * full skeleton load with no time to ride it, adherence is scored against an
 * unreachable target, and the explanation disappears.
 *
 * This is a named export rather than an inline expression because reverting it
 * to `target.hours` looks like a harmless simplification and, before this
 * existed, broke nothing any test could see.
 */
export function hoursForMaterialize(target: VolumeResult): number {
  return target.shortfall?.wantedHours ?? target.hours;
}
