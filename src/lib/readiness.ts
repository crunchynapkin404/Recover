/**
 * Readiness engine — written from scratch (Principle 1; the KOM-Wars
 * implementation has an inverted TSB sign and was deliberately not ported).
 *
 * Pure functions only: no db, no I/O. Scores are computed against the
 * athlete's OWN trailing baselines, not population norms.
 *
 * Components and weights (docs/PLAN.md):
 *   HRV   0.40  z-score of ln(hrv) vs baseline   → clamp(50 + 20z, 0, 100)
 *   RHR   0.25  inverted z-score                 → clamp(50 + 20z, 0, 100)
 *   Sleep 0.20  provider sleepScore, else duration curve
 *   Form  0.15  TSB = CTL − ATL                  → clamp(50 + 2.5·TSB, 10, 90)
 * Missing components renormalize the remaining weights.
 * Fewer than MIN_BASELINE_DAYS of HRV *and* of RHR history → "calibrating".
 */

/**
 * Fewer than this many days of HRV *and* of RHR baseline history →
 * "calibrating" (see the file's top-of-file comment). A design trade-off
 * between requiring enough data to trust a baseline and not gatekeeping a
 * new athlete too long — see
 * docs/specs/2026-07-15-v0.7-score-integrity-design.md, where flagging
 * enough bad days to drop the surviving baseline below this floor is the
 * intended, honest degrade path (a confident wrong number is worse than
 * "calibrating").
 * Source: Invented — a design trade-off, not cited research.
 * Confidence: Low.
 */
export const MIN_BASELINE_DAYS = 14;
/**
 * How far back each athlete's own HRV/RHR baseline mean and SD are
 * computed from. A design trade-off between baseline stability and
 * adaptability: docs/specs/2026-07-15-v0.7-score-integrity-design.md notes
 * the cost directly — "five days of flu put five crushed HRV values into
 * the trailing baseline for the next two months" — long enough to smooth
 * day-to-day noise, long enough that contamination from illness or travel
 * lingers, which is what that release's day-flagging feature exists to fix.
 * Source: Invented — a design trade-off, not cited research.
 * Confidence: Low.
 */
export const BASELINE_WINDOW_DAYS = 60;

const WEIGHTS = { hrv: 0.4, rhr: 0.25, sleep: 0.2, form: 0.15 } as const;

export type Band = "green" | "amber" | "red" | "calibrating";

export interface ReadinessInput {
  /** Today's values (null = not measured). */
  hrv: number | null;
  restingHr: number | null;
  sleepScore: number | null;
  sleepSecs: number | null;
  ctl: number | null;
  atl: number | null;
  /** Trailing-window history, most recent last, today excluded. */
  hrvBaseline: number[];
  rhrBaseline: number[];
}

export interface ComponentScores {
  hrv: number | null;
  rhr: number | null;
  sleep: number | null;
  form: number | null;
}

export interface ReadinessResult {
  readiness: number | null;
  band: Band;
  components: ComponentScores;
  tsb: number | null;
  baselines: {
    hrvLnMean: number | null;
    hrvLnSd: number | null;
    rhrMean: number | null;
    rhrSd: number | null;
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * TSB → the form component score, 10-90.
 *
 * Source: Invented. The 50-midpoint, the 2.5 slope and the 10/90 clamp are
 * an uncited design choice — a linear rescaling of TSB onto the same 0-100
 * scale the other readiness components use, so they can be weighted
 * together. No literature sets these values.
 * Confidence: Low.
 *
 * Owner: this function. `race/forecast.ts`'s `formOutlook()` calls it rather
 * than repeating the arithmetic — before v0.87 the expression was written
 * out in both files.
 */
export function formScore(tsb: number): number {
  return clamp(50 + 2.5 * tsb, 10, 90);
}

/**
 * Band cutoffs on a 0-100 score.
 *
 * Applied to two *different* scores: the composite readiness
 * (`computeReadiness`) and the form component alone
 * (`race/forecast.ts`'s `formOutlook`). That is one scale reused, not one
 * figure computed twice — a green form outlook and a green readiness are
 * different claims wearing the same colour.
 *
 * Source: Invented — uncited thresholds. Confidence: Low.
 */
export const FORM_BAND_THRESHOLDS = { green: 67, amber: 34 } as const;

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/**
 * Sample standard deviation (n−1). Variance below 1e-12 is floating-point
 * dust from identical values — treated as exactly 0 so flat baselines yield
 * z = 0 instead of amplifying noise.
 */
function sd(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const variance = xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1);
  return variance < 1e-12 ? 0 : Math.sqrt(variance);
}

/** Round to 1 decimal — stable component values for storage and display. */
function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function zToScore(z: number): number {
  return round1(clamp(50 + 20 * z, 0, 100));
}

/**
 * Sleep-duration fallback when the provider gives no sleepScore:
 * 100 on a 7.5–8.5h plateau, dropping 20 points per hour outside it.
 */
export function sleepDurationScore(sleepSecs: number): number {
  const hours = sleepSecs / 3600;
  const dist = hours < 7.5 ? 7.5 - hours : hours > 8.5 ? hours - 8.5 : 0;
  return Math.round(Math.min(100, Math.max(0, 100 - dist * 20)) * 10) / 10;
}

export function computeReadiness(input: ReadinessInput): ReadinessResult {
  const hrvHist = input.hrvBaseline.filter((v) => v > 0);
  const rhrHist = input.rhrBaseline.filter((v) => v > 0);

  const hrvCalibrated = hrvHist.length >= MIN_BASELINE_DAYS;
  const rhrCalibrated = rhrHist.length >= MIN_BASELINE_DAYS;

  const hrvLn = hrvHist.map(Math.log);
  const baselines = {
    hrvLnMean: hrvCalibrated ? mean(hrvLn) : null,
    hrvLnSd: hrvCalibrated ? sd(hrvLn) : null,
    rhrMean: rhrCalibrated ? mean(rhrHist) : null,
    rhrSd: rhrCalibrated ? sd(rhrHist) : null,
  };

  const components: ComponentScores = {
    hrv: null,
    rhr: null,
    sleep: null,
    form: null,
  };

  if (hrvCalibrated && input.hrv != null && input.hrv > 0) {
    // sd 0 (perfectly flat history) → treat today-as-baseline: z = 0
    const z =
      baselines.hrvLnSd! > 0
        ? (Math.log(input.hrv) - baselines.hrvLnMean!) / baselines.hrvLnSd!
        : 0;
    components.hrv = zToScore(z);
  }

  if (rhrCalibrated && input.restingHr != null && input.restingHr > 0) {
    const z =
      baselines.rhrSd! > 0
        ? (baselines.rhrMean! - input.restingHr) / baselines.rhrSd!
        : 0;
    components.rhr = zToScore(z);
  }

  if (input.sleepScore != null) {
    components.sleep = round1(clamp(input.sleepScore, 0, 100));
  } else if (input.sleepSecs != null && input.sleepSecs > 0) {
    components.sleep = sleepDurationScore(input.sleepSecs);
  }

  let tsb: number | null = null;
  if (input.ctl != null && input.atl != null) {
    tsb = round1(input.ctl - input.atl);
    components.form = round1(formScore(tsb));
  }

  // Recovery signals are the point of the score: without at least one
  // calibrated physiological component (HRV or RHR), sleep+form alone must
  // not masquerade as readiness.
  if (components.hrv == null && components.rhr == null) {
    return { readiness: null, band: "calibrating", components, tsb, baselines };
  }

  let weightSum = 0;
  let scoreSum = 0;
  for (const key of ["hrv", "rhr", "sleep", "form"] as const) {
    const score = components[key];
    if (score != null) {
      weightSum += WEIGHTS[key];
      scoreSum += WEIGHTS[key] * score;
    }
  }

  const readiness = Math.round(scoreSum / weightSum);
  const band: Band =
    readiness >= FORM_BAND_THRESHOLDS.green
      ? "green"
      : readiness >= FORM_BAND_THRESHOLDS.amber
        ? "amber"
        : "red";

  return { readiness, band, components, tsb, baselines };
}
