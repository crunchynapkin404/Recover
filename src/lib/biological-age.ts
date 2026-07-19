/**
 * Biological age estimate (v0.13) — pure, no db.
 *
 * A deliberately transparent composite: start from chronological age and
 * apply a small +/− year offset per available honest signal. There is no
 * black-box model — the offsets ARE the contract, and each is unit-tested.
 * Without a birth year or enough signals, it returns an explicit
 * insufficient-inputs state that names what's missing rather than guessing.
 */

/** Need at least this many component signals (plus a birth year) to estimate. */
export const MIN_BIOAGE_COMPONENTS = 3;
/** The estimate is clamped to ± this many years from chronological age. */
export const MAX_OFFSET_YEARS = 12;

export interface BioAgeInputs {
  /** Chronological age in years (from birthYear), or null. */
  chronologicalAge: number | null;
  /** Resting HR (bpm), lower is younger. */
  restingHr: number | null;
  /** HRV rMSSD (ms), higher is younger. */
  hrvMs: number | null;
  /** Sleep-consistency score 0–100 (v0.12), higher is younger. */
  sleepConsistency: number | null;
  /** VO2max (ml/kg/min), higher is younger. */
  vo2max: number | null;
  /** Body-fat percentage, lower (to a floor) is younger. */
  bodyFatPct: number | null;
}

export interface BioAgeComponent {
  key: string;
  label: string;
  offsetYears: number;
}

export interface BioAgeResult {
  bioAge: number;
  deltaYears: number;
  components: BioAgeComponent[];
}

export interface BioAgeInsufficient {
  insufficient: true;
  have: string[];
  missing: string[];
}

// Each signal contributes offset = clamp(slope × (reference − value), ±cap).
// A "younger" reading is a negative offset (lowers biological age).
const SIGNALS = [
  {
    key: "restingHr",
    label: "Resting HR",
    ref: 60, // bpm
    perUnit: 0.15, // years per bpm away from ref
    higherIsOlder: true,
    cap: 6,
  },
  {
    key: "hrvMs",
    label: "HRV",
    ref: 55, // ms
    perUnit: 0.08,
    higherIsOlder: false,
    cap: 6,
  },
  {
    key: "sleepConsistency",
    label: "Sleep consistency",
    ref: 75, // /100
    perUnit: 0.06,
    higherIsOlder: false,
    cap: 5,
  },
  {
    key: "vo2max",
    label: "VO₂max",
    ref: 42, // ml/kg/min
    perUnit: 0.25,
    higherIsOlder: false,
    cap: 8,
  },
  {
    key: "bodyFatPct",
    label: "Body fat",
    ref: 18, // %
    perUnit: 0.2,
    higherIsOlder: true,
    cap: 6,
  },
] as const;

function clamp(v: number, cap: number): number {
  return Math.max(-cap, Math.min(cap, v));
}

export function biologicalAge(
  inputs: BioAgeInputs
): BioAgeResult | BioAgeInsufficient {
  const values: Record<string, number | null> = {
    restingHr: inputs.restingHr,
    hrvMs: inputs.hrvMs,
    sleepConsistency: inputs.sleepConsistency,
    vo2max: inputs.vo2max,
    bodyFatPct: inputs.bodyFatPct,
  };

  const components: BioAgeComponent[] = [];
  const have: string[] = [];
  const missing: string[] = [];
  for (const s of SIGNALS) {
    const v = values[s.key];
    if (v == null) {
      missing.push(s.label);
      continue;
    }
    have.push(s.label);
    // Deviation above the reference, signed so "older" is positive.
    const deviation = s.higherIsOlder ? v - s.ref : s.ref - v;
    const offset = clamp(deviation * s.perUnit, s.cap);
    components.push({
      key: s.key,
      label: s.label,
      offsetYears: Math.round(offset * 10) / 10,
    });
  }

  if (inputs.chronologicalAge == null) missing.push("Birth year");

  if (
    inputs.chronologicalAge == null ||
    components.length < MIN_BIOAGE_COMPONENTS
  ) {
    return { insufficient: true, have, missing };
  }

  const totalOffset = clamp(
    components.reduce((sum, c) => sum + c.offsetYears, 0),
    MAX_OFFSET_YEARS
  );
  const bioAge = Math.max(
    18,
    Math.round((inputs.chronologicalAge + totalOffset) * 10) / 10
  );
  return {
    bioAge,
    deltaYears: Math.round((bioAge - inputs.chronologicalAge) * 10) / 10,
    components,
  };
}
