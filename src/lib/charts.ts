/** Pure chart math for the analytics pages. No I/O, no DOM. */

/**
 * Shared visual grammar for every hand-rolled SVG chart in the app
 * (stream-chart, wellness-trends, weekly-load-bars, artifact-card, and the
 * dashboard sparklines). Values are drawn from the union of what those charts
 * already used — see task-3-report.md for the per-file inventory — not a
 * fresh palette. Charts stay hand-rolled SVG; this just gives them one
 * source of truth instead of five locally hard-coded copies.
 */
export const CHART_TOKENS = {
  /**
   * Ordered series palette. Index 0-4 preserve artifact-card's original
   * generic palette (used by index for arbitrary AI-generated chart specs);
   * 5-10 are the semantic per-metric colors already used elsewhere
   * (heart rate, power, pace, sleep, etc.) so every call site can reference
   * one shared array instead of re-declaring the same hex.
   */
  series: [
    "#3b82f6", // blue-500   — generic series 1 / dashboard sleep-score spark
    "#ef4444", // red-500    — generic series 2
    "#34d399", // emerald-400 — generic series 3 / elevation / HRV
    "#f59e0b", // amber-500  — generic series 4
    "#a855f7", // purple-500 — generic series 5
    "#f87171", // red-400    — heart rate / resting heart rate
    "#a78bfa", // violet-400 — power
    "#22d3ee", // cyan-400   — pace
    "#818cf8", // indigo-400 — sleep duration
    "#e5e7eb", // gray-200   — neutral overlay (sleep score line)
    "#10b981", // emerald-500 — dashboard positive-trend spark
  ],
  /** Translucent baseline/reference band fill (e.g. a 60-day baseline ± SD). */
  band: "rgba(255,255,255,0.06)",
  /** Grid / reference-line color (e.g. an 8h sleep guide line). */
  grid: "rgba(255,255,255,0.35)",
  /** Dash pattern shared by every dashed guide or series line. */
  dash: "1.5 1",
  strokeWidth: {
    /** Dashed reference/guide lines. */
    hairline: 0.3,
    /** Faint secondary/raw series line drawn under a bolder overlay. */
    thin: 0.4,
    /** A line drawn over another series (e.g. sleep score over duration bars). */
    overlay: 0.6,
    /** Standard single-series line. */
    regular: 0.8,
    /** Emphasized line (e.g. a rolling average). */
    bold: 0.9,
    /** Compact dashboard sparkline path. */
    spark: 2,
  },
} as const;

/** Shared tooltip/label number format: round to `decimals` places (default 0). */
export function formatChartValue(v: number, decimals = 0): string {
  const factor = 10 ** decimals;
  return String(Math.round(v * factor) / factor);
}

export function downsample(
  values: (number | null)[],
  target = 300
): (number | null)[] {
  if (values.length <= target) return values;
  const bucketSize = values.length / target;
  const out: (number | null)[] = [];
  for (let b = 0; b < target; b++) {
    const start = Math.floor(b * bucketSize);
    const end = Math.min(values.length, Math.floor((b + 1) * bucketSize));
    let sum = 0;
    let n = 0;
    for (let i = start; i < end; i++) {
      const v = values[i];
      if (v != null) {
        sum += v;
        n++;
      }
    }
    out.push(n > 0 ? sum / n : null);
  }
  return out;
}

export function baselineBandLn(
  lnMean: number,
  lnSd: number
): { low: number; high: number } {
  return { low: Math.exp(lnMean - lnSd), high: Math.exp(lnMean + lnSd) };
}

export function baselineBandLinear(
  mean: number,
  sd: number
): { low: number; high: number } {
  return { low: mean - sd, high: mean + sd };
}

export function rollingAvg(
  values: (number | null)[],
  window = 7
): (number | null)[] {
  return values.map((_, i) => {
    const slice = values.slice(Math.max(0, i - window + 1), i + 1);
    const nums = slice.filter((v): v is number => v != null);
    if (nums.length === 0) return null;
    return nums.reduce((s, v) => s + v, 0) / nums.length;
  });
}

export function localYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function mondayOf(d: Date): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = (out.getDay() + 6) % 7; // Mon=0
  out.setDate(out.getDate() - dow);
  return out;
}

export interface WeeklyLoad {
  weekStart: string;
  load: number;
}

export interface WeeklyActivitySummary {
  weekStart: string;
  load: number;
  durationS: number;
  distanceM: number;
  sessions: number;
}

/** Monday-based weekly totals for the trailing `weeks`, zero-filled. */
export function weeklyActivitySummaries(
  activities: {
    startDate: Date;
    load: number | null;
    durationS: number | null;
    distanceM: number | null;
  }[],
  weeks = 12
): WeeklyActivitySummary[] {
  const thisMonday = mondayOf(new Date());
  const out: WeeklyActivitySummary[] = [];
  for (let w = weeks - 1; w >= 0; w--) {
    const start = new Date(thisMonday);
    start.setDate(start.getDate() - w * 7);
    out.push({
      weekStart: localYmd(start),
      load: 0,
      durationS: 0,
      distanceM: 0,
      sessions: 0,
    });
  }
  const index = new Map(out.map((e, i) => [e.weekStart, i]));
  for (const a of activities) {
    const i = index.get(localYmd(mondayOf(a.startDate)));
    if (i == null) continue;
    out[i].sessions += 1;
    out[i].load += a.load ?? 0;
    out[i].durationS += a.durationS ?? 0;
    out[i].distanceM += a.distanceM ?? 0;
  }
  for (const e of out) e.load = Math.round(e.load * 10) / 10;
  return out;
}

/** Monday-based weekly load sums for the trailing `weeks`, zero-filled. */
export function weeklyLoads(
  activities: { startDate: Date; load: number | null }[],
  weeks = 12
): WeeklyLoad[] {
  return weeklyActivitySummaries(
    activities.map((a) => ({ ...a, durationS: null, distanceM: null })),
    weeks
  ).map((s) => ({ weekStart: s.weekStart, load: s.load }));
}
