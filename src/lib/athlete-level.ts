/**
 * How much training this athlete can absorb — and a human label for it.
 *
 * Four levels, borrowed from JOIN's vocabulary, but DERIVED rather than
 * declared: the athlete's own history is better evidence than a self-
 * assessment.
 *
 * ## Hysteresis without a state machine
 *
 * Driven by a rolling PEAK_WINDOW_WEEKS peak rather than the current window.
 * A bad fortnight cannot move the level, because the peak from ten weeks ago
 * still stands; genuine detraining does, once that peak rolls off. There is no
 * `previousLevel` to thread through and nothing to store — which is what the
 * derive-at-rollover architecture needs.
 *
 * The "sticky up" asymmetry is safe ONLY because the level sets a ceiling and
 * never a target. A detrained athlete is held down by the ramp guard
 * (RAMP_CLAMP_PCT, ±20% of last week's actual) regardless of whether their
 * peak has rolled off yet. If this ever starts setting the target directly,
 * the rolling peak becomes the wrong mechanism.
 *
 * ## The level does not do the volume arithmetic
 *
 * Four buckets would map an athlete at 5.1h/week and one at 8.9h/week to the
 * same ceiling, with arbitrary cliffs at the band edges. The ceiling is
 * continuous off the same peak; the level's remaining jobs are the label the
 * athlete reads and the coarse difficulty input for workout templates.
 *
 * Pure — no I/O, no clock.
 */

export type AthleteLevel =
  "recreational" | "amateur" | "intermediate" | "advanced";

const ORDER: AthleteLevel[] = [
  "recreational",
  "amateur",
  "intermediate",
  "advanced",
];

export const LEVEL_CONSTANTS = {
  /** How far back the rolling peak looks. Long enough that illness or a
   *  holiday cannot reclassify an athlete; short enough that real detraining
   *  eventually does. */
  PEAK_WINDOW_WEEKS: 12,
  /** Weekly-hours ceiling as a multiple of the rolling peak. */
  HEADROOM: 1.3,
  /** Weekly-hours floor as a fraction of the rolling peak. Detraining
   *  research: a 70% volume reduction with intensity maintained preserves
   *  VO2max, and 50-75% of normal volume shows no aerobic loss. 0.6 sits
   *  inside that band, so the floor never prescribes less than holding
   *  fitness. */
  MAINTENANCE_FLOOR: 0.6,
  /** Upper bound of each band, in trailing weekly hours. `max` is exclusive
   *  (bandFor uses value < max), so a value exactly at a boundary — e.g.
   *  9 hours — falls into the next-higher band, not this one. */
  HOURS_BANDS: [
    { max: 3, level: "recreational" as AthleteLevel },
    { max: 5, level: "amateur" as AthleteLevel },
    { max: 9, level: "intermediate" as AthleteLevel },
    { max: Infinity, level: "advanced" as AthleteLevel },
  ],
  /** Upper bound of each band, in CTL. `max` is exclusive, same as
   *  HOURS_BANDS above — a value exactly at a boundary belongs to the
   *  next-higher band. */
  CTL_BANDS: [
    { max: 35, level: "recreational" as AthleteLevel },
    { max: 55, level: "amateur" as AthleteLevel },
    { max: 80, level: "intermediate" as AthleteLevel },
    { max: Infinity, level: "advanced" as AthleteLevel },
  ],
} as const;

export interface LevelInput {
  /** Weekly training hours, oldest first. De-duplicated by the caller. */
  weeklyHoursByWeek: number[];
  /** Weekly CTL, oldest first. */
  ctlByWeek: number[];
  override: AthleteLevel | null;
}

export interface LevelResult {
  level: AthleteLevel | null;
  peakHours: number | null;
  /**
   * Weekly-hours ceiling, derived from peak hours alone (peakHours *
   * HEADROOM). Independent of `level` — non-null whenever any hours history
   * exists, even while `source` is "calibrating" because CTL history is
   * still missing. Null only when there is no hours history at all.
   */
  ceilingHours: number | null;
  /**
   * Weekly-hours maintenance floor, derived from peak hours alone (peakHours
   * * MAINTENANCE_FLOOR). Null exactly when `ceilingHours` is null — both are
   * derived from the same `peakHours` in every return path, so volume.ts can
   * rely on floor and ceiling never disagreeing about whether history
   * exists.
   */
  floorHours: number | null;
  source: "override" | "computed" | "calibrating";
}

function bandFor(
  value: number,
  bands: readonly { max: number; level: AthleteLevel }[]
): AthleteLevel | null {
  // NaN (or +/-Infinity) makes every `value < band.max` comparison false, so
  // without this guard the loop falls through to the *last* band — the most
  // permissive level, in a module built to be conservative. Refuse instead.
  if (!Number.isFinite(value)) return null;
  for (const band of bands) {
    if (value < band.max) return band.level;
  }
  return bands[bands.length - 1].level;
}

function peakOf(series: number[], weeks: number): number | null {
  const window = series.slice(-weeks);
  if (window.length === 0) return null;
  const peak = Math.max(...window);
  // Math.max poisons the whole window if any single entry is NaN, and one
  // corrupt week among eleven good ones is the realistic failure mode — a bad
  // activity import, not an all-NaN series. Guard here rather than at each use
  // site: NaN is not nullish, so a caller writing `peak ?? fallback` would get
  // NaN back and carry it silently into arithmetic downstream.
  if (!Number.isFinite(peak)) return null;

  // A peak of zero is not a measurement. Every production caller
  // (weeklyHoursByWeek's fixed-length buckets, assembleVolumeInputs' CTL
  // bucketing loop) fills a full-length array of zeros rather than an empty
  // one when there is no history, so the `window.length === 0` guard above
  // can never fire from any real caller — it only protects hand-written test
  // literals. Gating on the VALUE instead of the shape makes "no training in
  // the window" read as null structurally, for both callers, rather than
  // relying on every producer to remember to special-case the empty case.
  // This matters downstream: volume.ts's `ceilingHours == null` branch is the
  // only thing standing between a no-history athlete and a race-demand
  // target computed against a zero ceiling.
  return peak > 0 ? peak : null;
}

export function athleteLevel(input: LevelInput): LevelResult {
  const peakHours = peakOf(
    input.weeklyHoursByWeek,
    LEVEL_CONSTANTS.PEAK_WINDOW_WEEKS
  );
  const peakCtl = peakOf(input.ctlByWeek, LEVEL_CONSTANTS.PEAK_WINDOW_WEEKS);

  // The ceiling is what actually bounds volume, and it needs measured hours.
  // Without them there is no ceiling, whatever the override says.
  const ceilingHours =
    peakHours == null ? null : peakHours * LEVEL_CONSTANTS.HEADROOM;
  // The floor derives from the very same peakHours value as the ceiling, in
  // every return path below. That makes it structurally impossible for floor
  // and ceiling to disagree about whether history exists — volume.ts relies
  // on that lockstep.
  const floorHours =
    peakHours == null ? null : peakHours * LEVEL_CONSTANTS.MAINTENANCE_FLOOR;

  if (input.override != null) {
    return {
      level: input.override,
      peakHours,
      ceilingHours,
      floorHours,
      source: "override",
    };
  }

  if (peakHours == null || peakCtl == null) {
    return {
      level: null,
      peakHours,
      ceilingHours,
      floorHours,
      source: "calibrating",
    };
  }

  // The lower of the two verdicts. High CTL from short hard sessions must not
  // claim four-hour-ride capacity; many easy hours must not claim VO2max
  // tolerance.
  const fromHours = bandFor(peakHours, LEVEL_CONSTANTS.HOURS_BANDS);
  const fromCtl = bandFor(peakCtl, LEVEL_CONSTANTS.CTL_BANDS);

  // Corrupt (non-finite) peak input: bandFor already refused to guess, and
  // there is no safe level to report here either.
  if (fromHours == null || fromCtl == null) {
    return {
      level: null,
      peakHours,
      ceilingHours,
      floorHours,
      source: "calibrating",
    };
  }

  const level =
    ORDER.indexOf(fromHours) <= ORDER.indexOf(fromCtl) ? fromHours : fromCtl;

  return { level, peakHours, ceilingHours, floorHours, source: "computed" };
}
