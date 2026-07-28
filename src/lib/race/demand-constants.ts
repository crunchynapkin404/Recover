/**
 * Coaching heuristics, not derived truth.
 *
 * Calibrated against one athlete and the published coaching consensus. They
 * live here, together and exported, so tuning is a one-line change with tests
 * that fail loudly — not a hunt through the engine. Never inline these values.
 */
export const DEMAND_CONSTANTS = {
  /** Effective frontal area (m²) for a rider on the hoods. */
  CDA: 0.32,
  /** Air density at low altitude (kg/m³). */
  AIR_DENSITY: 1.225,
  /** Wind, corners, rolling resistance, stops — flat speed is never ideal. */
  REAL_WORLD_FACTOR: 0.85,
  /** Fraction of FTP sustainable for an event of a given length. */
  FTP_FRACTION: [
    { upToHours: 3, fraction: 0.85 },
    { upToHours: 5, fraction: 0.75 },
    { upToHours: Infinity, fraction: 0.68 },
  ],
  /** Fixed-point iterations resolving "power needs duration needs power". */
  POWER_ITERATIONS: 2,
  /** Starting guess before the first iteration. */
  INITIAL_FTP_FRACTION: 0.75,
  /**
   * Weekly training volume as a share of the event's daily rate extrapolated
   * to a week. Replaces the earlier VOLUME_FACTOR, which was only ever
   * 7 × this.
   */
  TRAINING_FRACTION: 0.25,
  /** Default total mass (kg) when the athlete's weight is unknown. */
  DEFAULT_MASS_KG: 83,
} as const;
