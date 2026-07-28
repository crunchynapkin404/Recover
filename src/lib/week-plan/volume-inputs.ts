/**
 * Gathers everything the volume model needs, in one place, so the pure
 * modules stay pure: event demand, the athlete's rolling peak, and their
 * longest recent ride.
 */
import { and, desc, eq, gte } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { dedupeActivities } from "@/lib/training-load";
import { eventDemand, type EventDemand } from "@/lib/race/demand";
import {
  athleteLevel,
  LEVEL_CONSTANTS,
  type AthleteLevel,
  type LevelResult,
} from "@/lib/athlete-level";

/** Monday of the week containing `d`, at local midnight. */
function weekStartOf(d: Date): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  out.setDate(out.getDate() - ((out.getDay() + 6) % 7));
  return out;
}

/**
 * Oldest-first bucket index for the week starting at `weekStart`, in a
 * `weeks`-slot window ending at (and including) `thisWeek`. Shared by
 * weeklyHoursByWeek and the CTL-bucketing loop in assembleVolumeInputs so
 * the two copies of this arithmetic cannot drift. Out-of-window results
 * (negative, or >= weeks) are the caller's responsibility to skip.
 */
function weekIndex(weekStart: Date, thisWeek: Date, weeks: number): number {
  const weeksAgo = Math.round(
    (thisWeek.getTime() - weekStart.getTime()) / (7 * 24 * 3600 * 1000)
  );
  return weeks - 1 - weeksAgo;
}

// wellnessDaily.date is a Postgres `date` column, which drizzle types as a
// plain YYYY-MM-DD string (see races.date / dailyMetrics.date elsewhere in
// this codebase) — comparing it against a JS Date fails npx tsc --noEmit
// (TS2769). Same local-calendar convention as the many other `localYmd`
// helpers in src/lib/*.ts.
function localYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export interface HistoryActivity {
  provider: string;
  startDate: Date;
  durationS: number | null;
}

/**
 * Training hours per week for the last `weeks` weeks, oldest first, one entry
 * per week including zeros. De-duplicated across providers first: the same
 * ride reaches us once per connected service, and this feeds the level model.
 */
export function weeklyHoursByWeek(
  activities: HistoryActivity[],
  now: Date,
  weeks: number
): number[] {
  const thisWeek = weekStartOf(now);
  const buckets = new Array<number>(weeks).fill(0);

  const unique = dedupeActivities(
    activities.map((a) => ({
      provider: a.provider,
      startDate: a.startDate,
      durationS: a.durationS,
      load: null,
      avgHr: null,
      avgPower: null,
    }))
  );

  for (const a of unique) {
    const start = weekStartOf(a.startDate);
    const idx = weekIndex(start, thisWeek, weeks);
    if (idx < 0 || idx >= weeks) continue;
    buckets[idx] += (a.durationS ?? 0) / 3600;
  }
  return buckets;
}

/** Longest single de-duplicated ride in the window, in hours. */
export function longestRideHoursOf(
  activities: HistoryActivity[]
): number | null {
  const unique = dedupeActivities(
    activities.map((a) => ({
      provider: a.provider,
      startDate: a.startDate,
      durationS: a.durationS,
      load: null,
      avgHr: null,
      avgPower: null,
    }))
  );
  let longest = 0;
  for (const a of unique)
    longest = Math.max(longest, (a.durationS ?? 0) / 3600);
  return longest > 0 ? longest : null;
}

export interface VolumeInputsResult {
  demand: EventDemand | null;
  level: LevelResult;
  longestRideHours: number | null;
  targetRace: { id: string; name: string; date: string } | null;
}

export async function assembleVolumeInputs(
  userId: string,
  now: Date
): Promise<VolumeInputsResult> {
  const weeks = LEVEL_CONSTANTS.PEAK_WINDOW_WEEKS;
  const floor = new Date(now);
  floor.setDate(floor.getDate() - weeks * 7);

  const [rows, wellness, prefs, races] = await Promise.all([
    db.query.activities.findMany({
      where: and(
        eq(schema.activities.userId, userId),
        gte(schema.activities.startDate, floor)
      ),
    }),
    db.query.wellnessDaily.findMany({
      where: and(
        eq(schema.wellnessDaily.userId, userId),
        gte(schema.wellnessDaily.date, localYmd(floor))
      ),
      orderBy: desc(schema.wellnessDaily.date),
    }),
    db.query.bodyPrefs.findFirst({
      where: eq(schema.bodyPrefs.userId, userId),
    }),
    db.query.races.findMany({
      where: and(
        eq(schema.races.userId, userId),
        eq(schema.races.status, "upcoming"),
        // A past-due race with no synced result activity stays "upcoming"
        // forever (see runRaceDebriefs in race/debrief.ts — only
        // debriefedAt is set on the no-data path, never status). Without
        // this guard, sorted-by-date-ascending would let that stale race
        // outrank the real next race. Same convention as nextUpcomingRace
        // in race/service.ts.
        gte(schema.races.date, localYmd(now))
      ),
    }),
  ]);

  const history: HistoryActivity[] = rows.map((r) => ({
    provider: r.provider,
    startDate: r.startDateLocal ?? r.startDate,
    durationS: r.durationS,
  }));

  // CTL per week: the highest value seen in each week is what the rolling
  // peak wants, and wellness rows are daily.
  const ctlBuckets = new Array<number>(weeks).fill(0);
  const thisWeek = weekStartOf(now);
  for (const w of wellness) {
    if (w.ctl == null) continue;
    // w.date is a YYYY-MM-DD string; bare `new Date()` parses it as UTC
    // midnight, which lands in the wrong local week behind UTC. Same fix as
    // race/debrief.ts, race/service.ts, race/taper.ts, race/forecast.ts,
    // format.ts, sleep-insights.ts, morning-insight.ts, training-plan.ts.
    const start = weekStartOf(new Date(w.date + "T00:00:00"));
    const idx = weekIndex(start, thisWeek, weeks);
    if (idx < 0 || idx >= weeks) continue;
    ctlBuckets[idx] = Math.max(ctlBuckets[idx], w.ctl);
  }

  const level = athleteLevel({
    weeklyHoursByWeek: weeklyHoursByWeek(history, now, weeks),
    ctlByWeek: ctlBuckets,
    override: (prefs?.levelOverride as AthleteLevel | null) ?? null,
  });

  // Highest priority first, then nearest date — the same ordering the taper
  // uses, so there is one rule for "the race we are training for", not two.
  const order = { A: 0, B: 1, C: 2 } as const;
  const target =
    [...races].sort(
      (a, b) =>
        order[a.priority] - order[b.priority] || a.date.localeCompare(b.date)
    )[0] ?? null;

  let demand: EventDemand | null = null;
  if (target) {
    const stages = await db.query.raceStages.findMany({
      where: eq(schema.raceStages.raceId, target.id),
    });
    const latestWeight = wellness.find((w) => w.weightKg != null)?.weightKg;
    const latestEftp = wellness.find((w) => w.eftp != null)?.eftp;
    demand = eventDemand({
      eventDays: target.eventDays ?? 1,
      distanceKm: target.distanceKm,
      elevationM: target.elevationM,
      stages: stages.map((s) => ({
        dayNumber: s.dayNumber,
        distanceKm: s.distanceKm,
        elevationM: s.elevationM,
      })),
      overrideWeeklyHours: target.demandHoursOverride,
      ftpWatts:
        prefs?.ftpWatts ?? (latestEftp != null ? Math.round(latestEftp) : null),
      // Rider weight plus an allowance for bike and kit.
      massKg: latestWeight != null ? latestWeight + 8 : null,
    });
  }

  return {
    demand,
    level,
    longestRideHours: longestRideHoursOf(history),
    targetRace: target
      ? { id: target.id, name: target.name, date: String(target.date) }
      : null,
  };
}
