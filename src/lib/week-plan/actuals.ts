// src/lib/week-plan/actuals.ts — what the athlete actually did, per local day.
//
// The single source of truth for "what work happened on this date". Before
// v0.44 the week-plan service and /train each carried their own copy of this
// query and the two disagreed: the service windowed on
// coalesce(start_date_local, start_date) while /train used bare start_date,
// which silently dropped every row predating the start_date_local backfill.
import { and, desc, eq, gte, lt, ne, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { localYmd } from "@/lib/charts";
import type { DayActuals, DaySlot } from "./types";

/**
 * Sums the user's activities by local calendar day over [fromYmd, toYmd],
 * both inclusive.
 *
 * A day with no activity is ABSENT from the result rather than present with
 * zeroes. Callers need to tell "nothing happened" from "zero load":
 * `bookWeekActuals` clears the booking fields on a day it finds no entry for,
 * which is what lets a deleted activity stop counting.
 *
 * Strava rows are excluded throughout. Its Nov 2024 API agreement keeps its
 * data off AI surfaces and the week plan is one — the coach reads it through
 * get_week_plan. On top of that, every ride exists twice (once per connector)
 * with an identical start_date and no tie-break, and the two loads diverge
 * badly: live, the same ride reads 184 from intervals.icu and 83 from Strava.
 *
 * Both the window bound and the bucketing read LOCAL time, which is the
 * container's TZ (Europe/Amsterdam). That is the coupling to check first if
 * day boundaries ever look shifted again.
 */
export async function deriveDayActuals(
  userId: string,
  fromYmd: string,
  toYmd: string
): Promise<Record<string, DayActuals>> {
  const rows = await db.query.activities.findMany({
    where: and(
      eq(schema.activities.userId, userId),
      ne(schema.activities.provider, "strava"),
      // COALESCE at the SQL level, not in JS: start_date_local is nullable
      // and not fully backfilled, and NULL >= x is NULL in SQL — a plain
      // gte() would exclude those rows from the window entirely rather than
      // falling back to start_date.
      gte(
        sql`coalesce(${schema.activities.startDateLocal}, ${schema.activities.startDate})`,
        new Date(fromYmd + "T00:00:00")
      ),
      lt(
        sql`coalesce(${schema.activities.startDateLocal}, ${schema.activities.startDate})`,
        new Date(nextYmd(toYmd) + "T00:00:00")
      )
    ),
    // Newest first, so the first row seen for a day is that day's most
    // recent — the activity the rest/race branch already stored pre-v0.44.
    orderBy: desc(schema.activities.startDate),
  });

  const out: Record<string, DayActuals> = {};
  for (const a of rows) {
    const ymd = localYmd(a.startDateLocal ?? a.startDate);
    const acc = (out[ymd] ??= {
      count: 0,
      secs: 0,
      load: 0,
      activityId: a.id,
    });
    acc.count += 1;
    acc.secs += a.durationS ?? 0;
    acc.load += a.load ?? 0;
  }
  return out;
}

/**
 * Deliberately not `addDaysYmd` from ./service: service.ts imports this
 * module, and importing back would close a cycle.
 */
function nextYmd(ymd: string): string {
  const d = new Date(ymd + "T00:00:00");
  d.setDate(d.getDate() + 1);
  return localYmd(d);
}

export function weekActuals(days: DaySlot[]): {
  actualLoad: number;
  actualSessions: number;
} {
  return {
    // unplannedLoad is real training stress too (a rest-day bonus ride still
    // shows up in the athlete's legs) — it must count toward the week's
    // total exactly as actualLoad does. The two fields only differ in
    // whether they're allowed to trigger a replan; they're equal for
    // adherence and for next week's ramp-clamp target.
    actualLoad: days.reduce(
      (s, d) => s + (d.actualLoad ?? 0) + (d.unplannedLoad ?? 0),
      0
    ),
    // Sessions, not days: a completed day can hold two of them. markDayDone
    // refuses a day with no workouts and preserves the ones it has, so
    // summing is exact rather than an estimate.
    actualSessions: days
      .filter((d) => d.status === "completed")
      .reduce((s, d) => s + d.workouts.length, 0),
  };
}

/**
 * Books a day's load onto the field that fits it. Work the plan did not ask
 * for goes to `unplannedLoad`, which counts toward the week's actuals but
 * never triggers a replan — an extra easy hour on a rest day must not cost
 * you a session later in the week.
 *
 * A day that DID have a planned session books the whole activity's load as
 * that session's `actualLoad`, even when the activity ran long (e.g. a
 * planned 60min ride that turned into a 3hr group ride): there is no
 * expected-load figure on a `PlannedWorkout` to diff against (only duration
 * + a free-text intensity band), so splitting "the planned part" from "the
 * excess" would mean inventing an unspecified estimate rather than reading
 * one. The invariant this function exists to protect — no session is ever
 * removed for running over on load — holds either way: nothing here (or in
 * adaptDay) removes a session because of accumulated load.
 *
 * `load` is the day's TOTAL, not an increment — both fields are SET, so
 * calling this twice with the same figure is a no-op rather than a doubling.
 *
 * This books ONE field and leaves the other untouched, which is safe only
 * while a day's routing cannot change underneath it. `bookWeekActuals` is
 * the caller for which that does not hold — `adaptDay` empties a missed
 * day's `workouts` and flips its routing — so it does not call this; it
 * writes both fields itself, through the same `booksUnplanned` rule. The two
 * direct callers left are `runDailyAdaptation`'s legacy matched-activity
 * path and `scripts/backfill-day-load.ts`.
 *
 * Was `recordUnplannedLoad` before v0.44, which named half of what it does.
 */
export function bookDayLoad(day: DaySlot, load: number): DaySlot {
  return booksUnplanned(day)
    ? { ...day, unplannedLoad: load }
    : { ...day, actualLoad: load };
}

/**
 * Which field a day's load belongs in. A day with no planned session books
 * to `unplannedLoad`; a day that has one books to `actualLoad`.
 *
 * Extracted so `bookWeekActuals` can ask the same question without repeating
 * the rule — it needs the answer twice over, to set one field and clear the
 * other in a single object literal.
 */
export function booksUnplanned(day: DaySlot): boolean {
  return day.workouts.length === 0;
}

/**
 * Rewrites the booking fields on every day at or before `throughYmd` from
 * the derivation, and leaves later days alone.
 *
 * The stored fields become a pure function of the activities table. That is
 * the whole point of v0.44: before it, load was booked once, for yesterday
 * only, and only when yesterday's status happened to fall in one of two
 * branches — so a `completed` day (the app's own "Mark done" button), a
 * `missed` day, a cross-sport day, a second session, and any activity that
 * synced late all booked nowhere. The live week of 2026-07-27 closed at 314
 * against a real 783.
 *
 * Both fields are always rewritten together, never one of them. `bookDayLoad`
 * routes by whether the day still has workouts, and a day can change that
 * answer between passes — `handleMissedYesterday` empties a missed day. Since
 * `weekActuals` SUMS `actualLoad + unplannedLoad`, a leftover value from the
 * previous routing would double-count.
 *
 * A day with no activity has all three fields cleared rather than zeroed, so
 * a deleted activity stops counting and the JSON matches a day that never had
 * one. Setting to `undefined` rather than `delete`-ing is deliberate:
 * `JSON.stringify` omits undefined values, and spreading preserves key order,
 * so an unchanged day serialises byte-identically. `runDailyAdaptation`
 * compares stringified days to decide whether to write at all, so anything
 * that perturbs key order turns every pass into a database write.
 */
export function bookWeekActuals(
  days: DaySlot[],
  actuals: Record<string, DayActuals>,
  throughYmd: string
): DaySlot[] {
  return days.map((day) => {
    // Ymd strings compare lexicographically the same as chronologically —
    // the convention already used in replan.ts and service.ts.
    if (day.date > throughYmd) return day;
    const a = actuals[day.date];
    const unplanned = booksUnplanned(day);
    return {
      ...day,
      actualLoad: a && !unplanned ? a.load : undefined,
      unplannedLoad: a && unplanned ? a.load : undefined,
      activityId: a?.activityId,
    };
  });
}
