/**
 * Sleep intelligence engine (v0.12) — pure functions, no db, no I/O.
 *
 * Every output is gated on real provider data (the sleep-stage and
 * bed-window columns v0.11 added). Absent data returns null, never an
 * estimate — the same discipline as readiness's `calibrating`.
 */

export const MIN_CONSISTENCY_NIGHTS = 5;
/** Midpoint scatter at or beyond this (minutes SD) scores 0 consistency. */
export const MAX_SD_MINUTES = 120;
/** Chronotype needs at least this many nights on each of weekday/free-day. */
export const MIN_CHRONOTYPE_SIDE = 2;

const MINUTES_PER_DAY = 1440;

export interface SleepNight {
  date: string; // YYYY-MM-DD (wake date)
  sleepSecs: number | null;
  sleepDeepSecs: number | null;
  sleepRemSecs: number | null;
  sleepLightSecs: number | null;
  sleepAwakeSecs: number | null;
  bedStart: Date | null;
  bedEnd: Date | null;
}

export interface StageBreakdown {
  deepSecs: number;
  remSecs: number;
  lightSecs: number;
  awakeSecs: number;
  asleepSecs: number;
  fractions: { deep: number; rem: number; light: number; awake: number };
}

/**
 * Stage split for one night, or null when the provider sent no stage data.
 * Fractions are of total in-bed time (asleep + awake) so the stacked bar
 * sums to 1.
 */
export function stageBreakdown(night: SleepNight): StageBreakdown | null {
  const deep = night.sleepDeepSecs;
  const rem = night.sleepRemSecs;
  const light = night.sleepLightSecs;
  const awake = night.sleepAwakeSecs;
  if (deep == null && rem == null && light == null) return null;

  const deepSecs = deep ?? 0;
  const remSecs = rem ?? 0;
  const lightSecs = light ?? 0;
  const awakeSecs = awake ?? 0;
  const asleepSecs = deepSecs + remSecs + lightSecs;
  const inBed = asleepSecs + awakeSecs;
  if (inBed === 0) return null;

  return {
    deepSecs,
    remSecs,
    lightSecs,
    awakeSecs,
    asleepSecs,
    fractions: {
      deep: deepSecs / inBed,
      rem: remSecs / inBed,
      light: lightSecs / inBed,
      awake: awakeSecs / inBed,
    },
  };
}

/**
 * Sleep midpoint in minutes from local midnight of the wake date, handling
 * the overnight wrap so a 23:30→07:30 night reads ~03:30, not noon. Null
 * unless both bed edges are present.
 */
export function sleepMidpointMins(night: SleepNight): number | null {
  if (!night.bedStart || !night.bedEnd) return null;
  const start = night.bedStart.getTime();
  const end = night.bedEnd.getTime();
  if (end <= start) return null;
  const midMs = start + (end - start) / 2;
  const mid = new Date(midMs);
  return mid.getHours() * 60 + mid.getMinutes();
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/**
 * Circular mean of clock minutes (handles the midnight wrap): a set of
 * midpoints at 23:50 and 00:10 averages to 00:00, not noon.
 */
function circularMeanMins(mins: number[]): number {
  const angles = mins.map((m) => (m / MINUTES_PER_DAY) * 2 * Math.PI);
  const sin = mean(angles.map(Math.sin));
  const cos = mean(angles.map(Math.cos));
  let a = Math.atan2(sin, cos);
  if (a < 0) a += 2 * Math.PI;
  return (a / (2 * Math.PI)) * MINUTES_PER_DAY;
}

/** Smallest absolute difference between two clock minutes, across midnight. */
function circularDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % MINUTES_PER_DAY;
  return Math.min(d, MINUTES_PER_DAY - d);
}

/** Circular SD of clock minutes, in minutes. */
function circularSdMins(mins: number[]): number {
  const m = circularMeanMins(mins);
  const variance = mean(mins.map((x) => circularDiff(x, m) ** 2));
  return Math.sqrt(variance);
}

export interface SleepConsistency {
  score: number; // 0-100
  sampleNights: number;
  sdMinutes: number;
}

/**
 * Bed/wake regularity as a 0–100 score: the circular SD of sleep midpoint
 * over the window, linearly mapped so a perfectly regular schedule scores
 * 100 and ≥ MAX_SD_MINUTES of scatter scores 0. Null below the minimum
 * number of real bed/wake nights — the metric the sleep literature ranks
 * above duration, but only computable with actual times.
 */
export function sleepConsistency(
  nights: SleepNight[]
): SleepConsistency | null {
  const mids = nights
    .map(sleepMidpointMins)
    .filter((m): m is number => m != null);
  if (mids.length < MIN_CONSISTENCY_NIGHTS) return null;
  const sd = circularSdMins(mids);
  const score = Math.round(
    Math.max(0, Math.min(100, 100 * (1 - sd / MAX_SD_MINUTES)))
  );
  return { score, sampleNights: mids.length, sdMinutes: Math.round(sd) };
}

function minsToHhMm(mins: number): string {
  const m =
    ((Math.round(mins) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export interface Chronotype {
  midpointHhMm: string;
  socialJetlagMins: number;
  weekdayMidpointHhMm: string;
  freeDayMidpointHhMm: string;
}

/**
 * Chronotype from sleep midpoints, split by weekday vs free day (Fri/Sat
 * nights → Sat/Sun wake). Social jetlag is the circular gap between the two
 * midpoints — the body-clock cost of a shifting weekend schedule. Null
 * unless there are enough nights on each side.
 */
export function chronotype(nights: SleepNight[]): Chronotype | null {
  const withMid = nights
    .map((n) => ({ mid: sleepMidpointMins(n), date: n.date }))
    .filter((x): x is { mid: number; date: string } => x.mid != null);
  if (withMid.length === 0) return null;

  const weekday: number[] = [];
  const freeDay: number[] = [];
  for (const { mid, date } of withMid) {
    // Wake date's day-of-week: Sat(6)/Sun(0) wakes are free days.
    const dow = new Date(`${date}T00:00:00`).getDay();
    if (dow === 0 || dow === 6) freeDay.push(mid);
    else weekday.push(mid);
  }
  if (
    weekday.length < MIN_CHRONOTYPE_SIDE ||
    freeDay.length < MIN_CHRONOTYPE_SIDE
  )
    return null;

  const wMid = circularMeanMins(weekday);
  const fMid = circularMeanMins(freeDay);
  const overall = circularMeanMins(withMid.map((x) => x.mid));
  return {
    midpointHhMm: minsToHhMm(overall),
    socialJetlagMins: Math.round(circularDiff(wMid, fMid)),
    weekdayMidpointHhMm: minsToHhMm(wMid),
    freeDayMidpointHhMm: minsToHhMm(fMid),
  };
}

export interface DayNapSummary {
  totalAsleepSecs: number;
  sessions: number;
  napSecs: number;
}

/**
 * Sum multiple sleep sessions reported for one wake date honestly: the
 * longest session is the main sleep, the rest are naps, and the total is
 * their sum. Returns null with no sessions carrying a duration.
 */
export function napAware(
  sessions: Array<{ sleepSecs: number | null }>
): DayNapSummary | null {
  const durs = sessions
    .map((s) => s.sleepSecs)
    .filter((s): s is number => s != null && s > 0)
    .sort((a, b) => b - a);
  if (durs.length === 0) return null;
  const total = durs.reduce((a, b) => a + b, 0);
  return {
    totalAsleepSecs: total,
    sessions: durs.length,
    napSecs: total - durs[0],
  };
}
