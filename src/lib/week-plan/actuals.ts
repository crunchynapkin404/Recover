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
import type { DayActuals } from "./types";

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
