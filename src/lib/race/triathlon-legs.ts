/**
 * The three legs of a standard-distance triathlon.
 *
 * A lookup table is legitimate here where it would be indefensible for a gran
 * fondo: "Ironman" FIXES the course length, while "gran fondo" tells you
 * nothing about whether it climbs 800 m or 4000 m. These distances are
 * definitional, so this is a fact table, not inference.
 *
 * It exists because `races.distance_km` holds a single TOTAL and cannot be
 * decomposed — 226 km does not split back into 3.8 / 180 / 42.2.
 *
 * Keyed by `normaliseRaceType` so the race form's free text and the plan
 * tool's closed enum reach the same row. A miss returns null and the caller
 * refuses; the athlete's stated finish time is the way through.
 *
 * Pure — no I/O, no clock.
 */
import { normaliseRaceType } from "@/lib/plan-sport";

export interface TriathlonLegs {
  swimKm: number;
  bikeKm: number;
  runKm: number;
}

/**
 * Exact lookup, keyed by `normaliseRaceType` output.
 *
 * The bare key `triathlon` is deliberately ABSENT: it names a sport, not a
 * distance, and guessing a distance from it would put an unsourced number
 * into a training target.
 *
 * Source: governing-body course definitions (Ironman / World Triathlon),
 * per `docs/specs/2026-08-07-race-demand-evidence.md`'s summary table.
 * Confidence: High — definitional, not an estimate.
 */
export const TRIATHLON_LEGS: Record<string, TriathlonLegs> = {
  ironman: { swimKm: 3.8, bikeKm: 180, runKm: 42.2 },
  "70.3": { swimKm: 1.9, bikeKm: 90, runKm: 21.1 },
  halfironman: { swimKm: 1.9, bikeKm: 90, runKm: 21.1 },
  olympictri: { swimKm: 1.5, bikeKm: 40, runKm: 10 },
  olympictriathlon: { swimKm: 1.5, bikeKm: 40, runKm: 10 },
  sprinttri: { swimKm: 0.75, bikeKm: 20, runKm: 5 },
  sprinttriathlon: { swimKm: 0.75, bikeKm: 20, runKm: 5 },
};

/** The legs a race type implies, or null when it implies none. */
export function triathlonLegsFor(raceType: string): TriathlonLegs | null {
  if (!raceType) return null;
  return TRIATHLON_LEGS[normaliseRaceType(raceType)] ?? null;
}
