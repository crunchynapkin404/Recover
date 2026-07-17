import { percentile } from "./stats";

/**
 * Auto-tags derived from activities — computed on read, never stored.
 * Callers must exclude provider='strava' rows (analytics clause); this
 * module never sees a provider.
 */

export const AUTO_TAG_HARD = "🔥 Hard session";
export const AUTO_TAG_DOUBLE = "2️⃣ Double day";
export const AUTO_TAG_REST = "😴 Rest day";
export const AUTO_TAG_MORNING = "🌅 Morning training";
export const AUTO_TAG_LATE = "🌙 Late training";

export const AUTO_TAGS: Set<string> = new Set([
  AUTO_TAG_HARD,
  AUTO_TAG_DOUBLE,
  AUTO_TAG_REST,
  AUTO_TAG_MORNING,
  AUTO_TAG_LATE,
]);

const HARD_PERCENTILE = 0.75;
const MIN_TRAINING_DAYS = 20; // calibrating silence for 🔥
const DOUBLE_MIN_SECS = 20 * 60;
const MORNING_BEFORE_HOUR = 12;
const LATE_FROM_HOUR = 19;

export interface ActivityLite {
  startDate: Date;
  durationS: number | null;
  load: number | null;
}

export function localYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function addDaysYmd(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00`);
  d.setDate(d.getDate() + n);
  return localYmd(d);
}

export function deriveAutoTags(
  activities: ActivityLite[],
  window: { start: string; end: string }
): Map<string, string[]> {
  const byDay = new Map<string, ActivityLite[]>();
  for (const a of activities) {
    const day = localYmd(a.startDate);
    if (day < window.start || day > window.end) continue;
    const list = byDay.get(day) ?? [];
    list.push(a);
    byDay.set(day, list);
  }

  // Athlete-relative intensity threshold over the window's training days.
  const dayLoads = [...byDay.values()]
    .map((as) => as.reduce((s, a) => s + (a.load ?? 0), 0))
    .filter((l) => l > 0);
  const hardThreshold =
    dayLoads.length >= MIN_TRAINING_DAYS
      ? percentile(dayLoads, HARD_PERCENTILE)
      : null;

  const out = new Map<string, string[]>();
  for (let d = window.start; d <= window.end; d = addDaysYmd(d, 1)) {
    const as = byDay.get(d) ?? [];
    const tags: string[] = [];
    if (as.length === 0) {
      tags.push(AUTO_TAG_REST);
    } else {
      const dayLoad = as.reduce((s, a) => s + (a.load ?? 0), 0);
      if (hardThreshold != null && dayLoad > 0 && dayLoad >= hardThreshold)
        tags.push(AUTO_TAG_HARD);
      const longEnough = as.filter(
        (a) => (a.durationS ?? 0) >= DOUBLE_MIN_SECS
      );
      if (longEnough.length >= 2) tags.push(AUTO_TAG_DOUBLE);
      const hours = as.map(
        (a) => a.startDate.getHours() + a.startDate.getMinutes() / 60
      );
      if (Math.min(...hours) < MORNING_BEFORE_HOUR) tags.push(AUTO_TAG_MORNING);
      if (Math.max(...hours) >= LATE_FROM_HOUR) tags.push(AUTO_TAG_LATE);
    }
    out.set(d, tags);
  }
  return out;
}
