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

  // Annotated: DEMAND_CONSTANTS is `as const`, so an inferred type would be
  // the literal 0.75 and the reassignment below would not compile.
  let fraction: number = C.INITIAL_FTP_FRACTION;
  let hours = 0;

  for (let i = 0; i < C.POWER_ITERATIONS + 1; i++) {
    const powerW = ftpWatts * fraction;
    const speedKmh = flatSpeedKmh(powerW);

    // Work to lift mass against gravity, delivered at this power.
    const climbHours = (massKg * 9.81 * elevationM) / (powerW * 3600);
    const flatHours = distanceKm / speedKmh;

    // Those two terms overlap. The flat term charges the WHOLE distance at
    // flat speed; the climb term then adds the time to gain the elevation —
    // but you cover ground while climbing, so the ascending kilometres are
    // paid for twice. Subtract their flat-equivalent time.
    //
    // Without this correction a 130km/4000m alpine fondo came out at 8.6h for
    // a 3.9 W/kg rider who rides it in about 6:30.
    const climbDistanceKm = elevationM / 1000 / C.CLIMB_GRADIENT;
    // Capped at the whole distance: on a hill-climb time trial the ascent
    // accounts for every kilometre, and the overlap can never exceed the ride.
    const overlapHours = Math.min(flatHours, climbDistanceKm / speedKmh);

    hours = climbHours + flatHours - overlapHours;
    fraction = ftpFractionFor(hours);
  }

  return hours;
}
