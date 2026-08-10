/**
 * Biological age estimate (v0.13) — pure, no db.
 *
 * A deliberately transparent composite: start from chronological age and
 * apply a small +/− year offset per available honest signal. There is no
 * black-box model — the offsets ARE the contract, and each is unit-tested.
 * Without a birth year or enough signals, it returns an explicit
 * insufficient-inputs state that names what's missing rather than guessing.
 */

import { sleepConsistency } from "./sleep-insights";

/**
 * Need at least this many component signals (plus a birth year) to
 * estimate. Source: `docs/specs/2026-07-18-v0.13-deep-biology-design.md`
 * describes the mechanism (5 possible signals — RHR, HRV, sleep
 * consistency, VO2max, body-fat% — each mapping to a small offset) but
 * does not derive why 3-of-5 specifically. Confidence: Low.
 */
export const MIN_BIOAGE_COMPONENTS = 3;
/**
 * The estimate is clamped to ± this many years from chronological age.
 * Source: same design doc ("clamped to a sane range") — a sanity bound,
 * not a derived figure. Confidence: Low.
 */
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

/**
 * How many trailing nights the sleep-consistency signal (fed into
 * `bioAgeFrom`) looks back over.
 * Source: `docs/specs/2026-07-18-v0.13-deep-biology-design.md` and both
 * former call sites used 30 days; not independently derived here.
 * Confidence: Low.
 */
export const BIO_AGE_NIGHTS_WINDOW_DAYS = 30;

/**
 * `ymd` minus `days`, as a YYYY-MM-DD string. Built from the given date
 * only — never the system clock — so `bioAgeFrom` below stays pure.
 *
 * Duplicated from the identically-named helper in sleep-debt.ts rather than
 * imported from it: the two modules own unrelated figures (sleep debt vs
 * bio-age) that each independently need "N days before a YMD string", and
 * importing one pure lib into the other for a three-line date helper would
 * wire them together for no real reason — a worse dependency than the
 * duplication it would remove.
 */
function subtractDaysYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/** The wellness-row fields `bioAgeFrom` reads. A structural subset — both
 * call sites' `wellnessDaily` rows satisfy this without a cast. */
export interface BioAgeWellnessRow {
  date: string;
  restingHr: number | null;
  hrvMs: number | null;
  vo2max: number | null;
  bodyFatPct: number | null;
  sleepSecs: number | null;
  sleepDeepSecs: number | null;
  sleepRemSecs: number | null;
  sleepLightSecs: number | null;
  sleepAwakeSecs: number | null;
  bedStart: Date | null;
  bedEnd: Date | null;
}

/**
 * The one owner of bio-age's inputs. `app/body/page.tsx` and
 * `lib/tools/get-biomarkers.ts` built this ~20-line assembly independently
 * (same birthYear arithmetic, same `[...wellness].reverse().find(...)`
 * "latest non-null" searches for resting HR/HRV, VO2max and body-fat%, same
 * 30-day nights window feeding `sleepConsistency()`) — see
 * docs/specs/2026-08-11-display-derived-figures-ownership-design.md
 * section 2. This is now the single place that definition lives.
 *
 * The two presentations (`Figure<BioAgeResult>` on the page, `{ status:
 * "insufficient" }` on the MCP tool) are NOT this function's job — it
 * returns `biologicalAge()`'s raw result and each caller keeps presenting
 * it exactly as it already does.
 *
 * Pure: `today` is a parameter rather than `new Date()`, so this stays
 * testable without mocking the clock.
 */
export function bioAgeFrom(
  wellness: BioAgeWellnessRow[],
  prefs: { birthYear: number | null } | null,
  today: string
): BioAgeResult | BioAgeInsufficient {
  const chronologicalAge =
    prefs?.birthYear != null
      ? Number(today.slice(0, 4)) - prefs.birthYear
      : null;

  const latestWellness = [...wellness]
    .reverse()
    .find((w) => w.restingHr != null || w.hrvMs != null);

  const cutoff = subtractDaysYmd(today, BIO_AGE_NIGHTS_WINDOW_DAYS);
  const nights = wellness
    .filter((w) => w.date >= cutoff)
    .map((w) => ({
      date: w.date,
      sleepSecs: w.sleepSecs,
      sleepDeepSecs: w.sleepDeepSecs,
      sleepRemSecs: w.sleepRemSecs,
      sleepLightSecs: w.sleepLightSecs,
      sleepAwakeSecs: w.sleepAwakeSecs,
      bedStart: w.bedStart,
      bedEnd: w.bedEnd,
    }));
  const consistency = sleepConsistency(nights);

  return biologicalAge({
    chronologicalAge,
    restingHr: latestWellness?.restingHr ?? null,
    hrvMs: latestWellness?.hrvMs ?? null,
    sleepConsistency: consistency?.score ?? null,
    vo2max:
      [...wellness].reverse().find((w) => w.vo2max != null)?.vo2max ?? null,
    bodyFatPct:
      [...wellness].reverse().find((w) => w.bodyFatPct != null)?.bodyFatPct ??
      null,
  });
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
