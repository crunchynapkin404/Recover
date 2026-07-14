/** Pure chart math for the analytics pages. No I/O, no DOM. */

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

function localYmd(d: Date): string {
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

/** Monday-based weekly load sums for the trailing `weeks`, zero-filled. */
export function weeklyLoads(
  activities: { startDate: Date; load: number | null }[],
  weeks = 12
): WeeklyLoad[] {
  const thisMonday = mondayOf(new Date());
  const out: WeeklyLoad[] = [];
  for (let w = weeks - 1; w >= 0; w--) {
    const start = new Date(thisMonday);
    start.setDate(start.getDate() - w * 7);
    out.push({ weekStart: localYmd(start), load: 0 });
  }
  const index = new Map(out.map((e, i) => [e.weekStart, i]));
  for (const a of activities) {
    const key = localYmd(mondayOf(a.startDate));
    const i = index.get(key);
    if (i != null && a.load != null) out[i].load += a.load;
  }
  for (const e of out) e.load = Math.round(e.load * 10) / 10;
  return out;
}
