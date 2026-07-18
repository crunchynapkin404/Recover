/**
 * Blood pressure classification + trend (v0.13) — pure, no db.
 *
 * Bands follow the 2017 ACC/AHA guideline. A reading's category is the
 * higher-severity of its systolic and diastolic classification (standard
 * clinical practice). Everything returns null on missing input — never a
 * fabricated band.
 */

export type BpCategory = "normal" | "elevated" | "stage1" | "stage2" | "crisis";

export const BP_LABELS: Record<BpCategory, string> = {
  normal: "Normal",
  elevated: "Elevated",
  stage1: "Stage 1 hypertension",
  stage2: "Stage 2 hypertension",
  crisis: "Hypertensive crisis",
};

const SEVERITY: BpCategory[] = [
  "normal",
  "elevated",
  "stage1",
  "stage2",
  "crisis",
];

function systolicCategory(s: number): BpCategory {
  if (s >= 180) return "crisis";
  if (s >= 140) return "stage2";
  if (s >= 130) return "stage1";
  if (s >= 120) return "elevated";
  return "normal";
}

function diastolicCategory(d: number): BpCategory {
  if (d >= 120) return "crisis";
  if (d >= 90) return "stage2";
  if (d >= 80) return "stage1";
  // Elevated is defined by systolic only; diastolic < 80 is normal.
  return "normal";
}

export interface BpClassification {
  category: BpCategory;
  label: string;
  systolic: number;
  diastolic: number;
}

/** Classify one reading (the more severe of systolic/diastolic wins). */
export function classifyBp(
  systolic: number | null,
  diastolic: number | null
): BpClassification | null {
  if (systolic == null || diastolic == null) return null;
  if (systolic <= 0 || diastolic <= 0) return null;
  const s = systolicCategory(systolic);
  const d = diastolicCategory(diastolic);
  const category = SEVERITY.indexOf(s) >= SEVERITY.indexOf(d) ? s : d;
  return { category, label: BP_LABELS[category], systolic, diastolic };
}

export const MIN_BP_READINGS = 3;

export interface BpReading {
  date: string;
  systolic: number | null;
  diastolic: number | null;
}

export type BpDirection = "rising" | "falling" | "steady";

export interface BpTrend {
  latest: BpClassification;
  avgSystolic: number;
  avgDiastolic: number;
  direction: BpDirection;
  readings: number;
}

/**
 * Recent average + direction over readings that carry both numbers. The
 * direction compares the newer half's mean systolic to the older half's,
 * with a small deadband so noise doesn't read as a trend. Null below
 * MIN_BP_READINGS — a trend from one reading is not a trend.
 */
export function bpTrend(readings: BpReading[]): BpTrend | null {
  const valid = readings
    .filter(
      (r): r is { date: string; systolic: number; diastolic: number } =>
        r.systolic != null &&
        r.diastolic != null &&
        r.systolic > 0 &&
        r.diastolic > 0
    )
    .sort((a, b) => a.date.localeCompare(b.date));
  if (valid.length < MIN_BP_READINGS) return null;

  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const avgSystolic = Math.round(mean(valid.map((r) => r.systolic)));
  const avgDiastolic = Math.round(mean(valid.map((r) => r.diastolic)));

  const half = Math.floor(valid.length / 2);
  const older = mean(valid.slice(0, half).map((r) => r.systolic));
  const newer = mean(valid.slice(valid.length - half).map((r) => r.systolic));
  const delta = newer - older;
  const direction: BpDirection =
    delta > 3 ? "rising" : delta < -3 ? "falling" : "steady";

  const last = valid[valid.length - 1];
  return {
    latest: classifyBp(last.systolic, last.diastolic)!,
    avgSystolic,
    avgDiastolic,
    direction,
    readings: valid.length,
  };
}
