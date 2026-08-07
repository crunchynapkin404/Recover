/**
 * Every constant the periodization skeleton uses, with a source and a
 * confidence per value.
 *
 * Same contract as race/demand-constants.ts: they live here, together and
 * exported, so tuning is a one-line change with tests that fail loudly —
 * not a hunt through the engine. Never inline these values.
 *
 * Each key MUST have a row in docs/specs/2026-08-06-periodize-evidence.md.
 * plan-constants.test.ts fails CI otherwise. That test is deliberately not
 * database-gated, so the binding actually holds on a PR.
 *
 * Most of these are LOW confidence. That is the honest reading of the
 * evidence, not a gap to be filled in later with a rounder number.
 */
export const PLAN_CONSTANTS = {
  /**
   * Share of the plan spent in each phase. Peak takes the remainder.
   * Coaching convention (traditional linear periodization). No comparative
   * evidence for this split over any other. Confidence: Low.
   */
  PHASE_SHARE_BASE: 0.4,
  PHASE_SHARE_BUILD: 0.3,
  PHASE_SHARE_TAPER: 0.15,

  /** Floors so a short plan still has every phase. Arbitrary. Confidence: Low. */
  MIN_BASE_WEEKS: 2,
  MIN_BUILD_WEEKS: 1,
  MIN_TAPER_WEEKS: 2,
  MIN_PEAK_WEEKS: 1,

  /**
   * Weekly load implied by a CTL, as TSS. CTL is an exponentially weighted
   * mean of daily TSS with a 42-day constant, so a steady weekly load L
   * settles at CTL ≈ L/7 — the inverse used here. Sound arithmetic on the
   * Banister/TRIMP model, not an empirical claim. Confidence: Medium.
   */
  CTL_TO_WEEKLY_LOAD: 7,

  /** Floor so a zero-CTL athlete still gets a plan. Arbitrary. Confidence: Low. */
  MIN_WEEKLY_LOAD: 100,

  /**
   * Week-over-week load progression per phase. Convention, in the range
   * coaching sources describe as "5-10 % per week". No head-to-head
   * evidence for these exact figures. Confidence: Low.
   */
  PROGRESSION_BASE: 1.08,
  PROGRESSION_BUILD: 1.07,
  PROGRESSION_PEAK: 1.02,

  /**
   * Absolute cap on one week's rise, as a share of the starting load, so
   * the percentage cannot run away early. Arbitrary. Confidence: Low.
   */
  PROGRESSION_STEP_CAP: 0.1,

  /**
   * Recovery week load, as a share of the preceding loading week. Sits
   * inside the 50-75 % band the detraining literature says maintains
   * VO2max — see the volume evidence doc §2. Confidence: Medium.
   */
  RECOVERY_FRACTION: 0.6,

  /**
   * The recovery cadence, expressed as "every Nth week is recovery" — so a
   * value of 4 means 3 loading weeks followed by 1 recovery week (3:1), and
   * 3 means 2 loading weeks followed by 1 recovery week (2:1). 3:1 and 2:1
   * are coaching convention with NO comparative evidence in endurance
   * athletes. Do not cite Issurin 2010 for this — that is block
   * periodization, a different model. Confidence: Low.
   */
  RECOVERY_INTERVAL_BASE: 4,
  RECOVERY_INTERVAL_DEFAULT: 3,

  /**
   * Hours multipliers shaping the week's prescribed volume within a phase.
   * Pure convention, fitted to feel. Confidence: Low.
   */
  HOURS_BASE_INTERCEPT: 0.85,
  HOURS_BASE_SLOPE: 0.05,
  HOURS_BUILD_INTERCEPT: 1.0,
  HOURS_BUILD_SLOPE: 0.03,
  HOURS_PEAK: 1.1,

  /**
   * Maximum CTL rise per week the skeleton may plan for, in TSS/week.
   *
   * This is the bound that was missing. effectiveWeekLoad already clamps
   * week-over-week change to ±RAMP_CLAMP_PCT (0.2) of last week's ACTUAL
   * load — but the skeleton progresses at 8 %/week, and 8 < 20, so that
   * clamp never fires against it. Each step is individually legal and the
   * error compounds: 1.08^20 is 4.7x.
   *
   * 5 TSS/week is the Coggan/Friel ramp-rate guidance, widely used in
   * coaching practice and in TrainingPeaks' own ramp-rate warning. It is
   * NOT a validated injury threshold and no RCT supports the specific
   * number. Confidence: Medium.
   */
  CTL_RAMP_PER_WEEK: 5,
} as const;
