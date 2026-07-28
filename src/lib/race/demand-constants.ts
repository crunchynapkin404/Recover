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
  /**
   * Average gradient of the climbing portions of an event. Used to work out
   * how much of the total distance is spent ascending, so that distance is
   * not charged twice — see riding-time.ts.
   */
  CLIMB_GRADIENT: 0.07,
  /** Fixed-point iterations resolving "power needs duration needs power". */
  POWER_ITERATIONS: 2,
  /** Starting guess before the first iteration. */
  INITIAL_FTP_FRACTION: 0.75,
  /**
   * An event's total load as a multiple of a weekly training load, at one day.
   * A long sportive is 200-350 TSS against ~630 sustainable weekly TSS at
   * CTL 90 — about half a training week. Cross-checked against published
   * 8-12 h/week century plans.
   */
  EVENT_TO_WEEKLY_1DAY: 0.6,
  /**
   * How that multiple grows with event length. Fitted to exactly two anchors:
   * 0.60 at one day (above) and 2.50 at eight days (CTS: "a multi-day event is
   * likely 2-3 times your normal weekly training load").
   */
  MULTI_DAY_EXPONENT: 0.686,
  /** Default total mass (kg) when the athlete's weight is unknown. */
  DEFAULT_MASS_KG: 83,
} as const;
