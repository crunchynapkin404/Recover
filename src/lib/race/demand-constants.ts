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
  /**
   * Sustainable share of FTP against the duration of a CONTINUOUS effort,
   * as interpolation anchors rather than steps. Same three fractions the
   * step bands used; the difference is that they are now reached smoothly.
   *
   * Stepping made estimates unstable at the edges: 114km predicted 4.985h
   * and 116km predicted 5.424h, an 8.8% jump for 1.75% more distance.
   *
   * Flat below the first anchor and above the last. The flat tail matters:
   * extrapolating the decline out to a 42-hour "ride" would produce a
   * sustainable fraction no rider could be measured at, and the demand model
   * must never be handed a duration it treats as one continuous effort when
   * it is not. The 8h anchor is where 0.68 becomes fully effective and is
   * LOW CONFIDENCE — it is a reading of what the old `>5h` band meant, not a
   * published figure.
   */
  FTP_FRACTION_ANCHORS: [
    { hours: 3, fraction: 0.85 },
    { hours: 5, fraction: 0.75 },
    { hours: 8, fraction: 0.68 },
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
  /**
   * Riegel's endurance exponent: T2 = T1 * (D2/D1)^k.
   *
   * Riegel 1981, "Athletic Records and Human Endurance", American Scientist
   * 69(3):285-290. The running counterpart of FTP_FRACTION_ANCHORS — the same
   * job (how sustainable pace decays with duration), from a published source.
   *
   * CONFIDENCE: MEDIUM. Vickers & Vertosick 2016 (BMC Sports Sci Med Rehabil,
   * "An empirical study of race times in recreational endurance runners")
   * found the exponent varies with training volume and runs ABOVE 1.06 for
   * recreational runners — meaning this value UNDERSTATES a recreational
   * athlete's marathon time. The magnitude is not characterised here and
   * should not be described as small: secondary summaries of that work put
   * the standard-Riegel marathon underestimate at roughly ten minutes for
   * half of recreational runners, and the primary paper has not been checked
   * against that figure. What IS known is the DIRECTION, and it is the safe
   * one: a shorter predicted race understates demand rather than prescribing
   * training nobody can absorb.
   */
  RIEGEL_EXPONENT: 1.06,
  /**
   * Metres of ascent priced as one kilometre of flat running (ITRA
   * "km-effort": km_effort = distance_km + elevation_m / 100).
   *
   * CONFIDENCE: LOW, and this is a CONVENTION, not physiology — the same
   * status v0.45 assigned the 3:1 mesocycle. A Minetti-derived metabolic
   * model (Minetti et al. 2002, J Appl Physiol, "Energy cost of walking and
   * running at extreme uphill and downhill slopes") is the rigorous
   * alternative and is deliberately NOT used: it needs a grade distribution
   * the race form does not collect, and the honest error bar on the pace
   * anchor is wider than the gap between the two models.
   */
  VERTICAL_METRES_PER_FLAT_KM: 100,
} as const;
