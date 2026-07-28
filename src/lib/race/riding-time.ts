/**
 * How long an event actually takes this rider — from its distance and
 * elevation, and their power and mass.
 *
 * Physics rather than a lookup table by race type, because every input already
 * exists in the database (`body_prefs.ftp_watts`, `wellness_daily.eftp`,
 * `wellness_daily.weight_kg`) and because "gran fondo" tells you nothing about
 * whether it climbs 800m or 4000m.
 *
 * Pure — no I/O, no clock.
 */
import { DEMAND_CONSTANTS as C } from "./demand-constants";

export interface RidingTimeInput {
  /** Total distance in km (summed across all days for a stage event). */
  distanceKm: number;
  /** Total elevation gain in metres. */
  elevationM: number;
  ftpWatts: number;
  /** Rider plus bike plus kit, in kg. */
  massKg: number;
}

/** Sustainable share of FTP for an event expected to last `hours`. */
function ftpFractionFor(hours: number): number {
  for (const band of C.FTP_FRACTION) {
    if (hours <= band.upToHours) return band.fraction;
  }
  return C.FTP_FRACTION[C.FTP_FRACTION.length - 1].fraction;
}

/**
 * Steady speed on the flat at a given power, from the drag equation
 * `P = ½ ρ CdA v³`, scaled by REAL_WORLD_FACTOR for everything the drag
 * equation ignores.
 */
function flatSpeedKmh(powerW: number): number {
  const v = Math.cbrt(powerW / (0.5 * C.AIR_DENSITY * C.CDA));
  return v * 3.6 * C.REAL_WORLD_FACTOR;
}

/**
 * Estimated moving time in hours, or null when the inputs cannot support an
 * estimate. Null is deliberate: a fabricated duration would propagate into a
 * training target and a feasibility verdict.
 *
 * Sustainable power depends on how long the event lasts, and the duration
 * depends on the power — resolved by fixed-point iteration, which converges
 * within a couple of passes because the FTP bands are coarse.
 */
export function estimateRidingHours(input: RidingTimeInput): number | null {
  const { distanceKm, ftpWatts, massKg } = input;
  // Descending does not give time back in any model worth trusting.
  const elevationM = Math.max(0, input.elevationM);

  if (!(distanceKm > 0) || !(ftpWatts > 0) || !(massKg > 0)) return null;

  let fraction: number = C.INITIAL_FTP_FRACTION;
  let hours = 0;

  for (let i = 0; i < C.POWER_ITERATIONS + 1; i++) {
    const powerW = ftpWatts * fraction;
    // Work to lift mass against gravity, delivered at this power.
    const climbHours = (massKg * 9.81 * elevationM) / (powerW * 3600);
    const flatHours = distanceKm / flatSpeedKmh(powerW);
    hours = climbHours + flatHours;
    fraction = ftpFractionFor(hours);
  }

  return hours;
}
