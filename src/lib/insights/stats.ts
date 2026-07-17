/** Pure statistics helpers for insights. No I/O, no Date. */

export function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function sampleVariance(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1);
}

// Two-sided 95% t-critical values for df 1..30; 1.96 beyond. Indexed df-1.
const T_95 = [
  12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201,
  2.179, 2.16, 2.145, 2.131, 2.12, 2.11, 2.101, 2.093, 2.086, 2.08, 2.074,
  2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042,
];

export function tCritical95(df: number): number {
  if (df < 1) return T_95[0];
  if (df <= 30) return T_95[Math.floor(df) - 1];
  return 1.96;
}

/** Linear-interpolation percentile, p in [0,1]. xs must be non-empty. */
export function percentile(xs: number[], p: number): number {
  const sorted = [...xs].sort((a, b) => a - b);
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export interface WelchComparison {
  diff: number; // mean(a) − mean(b)
  halfWidth: number; // 95% CI half-width on the difference
  conclusive: boolean; // CI does not cross zero
}

/**
 * Welch two-sample comparison of means with a t-based 95% CI
 * (Welch–Satterthwaite degrees of freedom). Null when a side has n < 2 —
 * no variance estimate, no honest interval.
 */
export function welchCompare(a: number[], b: number[]): WelchComparison | null {
  if (a.length < 2 || b.length < 2) return null;
  const va = sampleVariance(a) / a.length;
  const vb = sampleVariance(b) / b.length;
  const diff = mean(a) - mean(b);
  const se = Math.sqrt(va + vb);
  if (se === 0) return { diff, halfWidth: 0, conclusive: diff !== 0 };
  const df =
    (va + vb) ** 2 / (va ** 2 / (a.length - 1) + vb ** 2 / (b.length - 1));
  const halfWidth = tCritical95(df) * se;
  return { diff, halfWidth, conclusive: Math.abs(diff) > halfWidth };
}
