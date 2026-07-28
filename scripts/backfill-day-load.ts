/**
 * One-off backfill: book each already-passed day's real activity onto the
 * stored week plan, for days the daily adaptation never booked.
 *
 * Why this exists. `runDailyAdaptation` books load for YESTERDAY only, and its
 * completion matcher compared the planner's sport ("Bike") to the provider's
 * ("Ride") with a raw equality — so for a cyclist it never matched. Every day
 * therefore kept `actualLoad`/`unplannedLoad` null, `weekActuals()` summed to
 * zero, every week closed as "fully missed", and `effectiveWeekLoad` restarted
 * the following week at 60% of its skeleton target. Week after week.
 *
 * Fixing the matcher (src/lib/canonical-sport.ts) stops it happening again, but
 * cannot repair days already behind us: nothing re-visits a past day. Without
 * this, the current week still closes as fully missed and the athlete eats one
 * more 60% restart.
 *
 * Scope: the OPEN week and the most recently CLOSED week per user — the two
 * that still influence the next rollover. Deliberately not all history: older
 * weeks have already had their adjustments logged and their CTL consumed.
 *
 * Applies exactly the rules runDailyAdaptation uses, so a backfilled day is
 * indistinguishable from one booked live:
 *   - a day holding a planned session takes the load of an activity matching
 *     that session's sport (canonically) → `actualLoad`
 *   - a day holding none books any activity's load → `unplannedLoad`
 *   - cross-provider duplicates are collapsed first, so a ride synced from both
 *     intervals.icu and Strava is counted once
 *
 * Idempotent: a day that already carries `activityId`, `actualLoad` or
 * `unplannedLoad` is left untouched. Safe to re-run.
 *
 * Usage: npx tsx scripts/backfill-day-load.ts [--dry-run] [--user <id>]
 */
import { fileURLToPath } from "node:url";
import { and, asc, desc, eq, gte, lt, sql } from "drizzle-orm";
// Relative imports, not "@/" — matches the other scripts: tsx run standalone
// doesn't resolve the tsconfig path alias.
import { db, schema } from "../src/lib/db";
import { dedupeActivities, type LoadActivity } from "../src/lib/training-load";
import { canonicalSport, sportMatches } from "../src/lib/canonical-sport";
import { recordUnplannedLoad } from "../src/lib/week-plan/service";
import type { DaySlot } from "../src/lib/week-plan/types";

interface Change {
  weekStart: string;
  date: string;
  field: "actualLoad" | "unplannedLoad";
  load: number;
  from: string;
}

async function backfill(opts: {
  dryRun: boolean;
  userId?: string;
}): Promise<{ changes: Change[]; skipped: string[] }> {
  const changes: Change[] = [];
  const skipped: string[] = [];

  const users = opts.userId
    ? [{ id: opts.userId }]
    : await db.select({ id: schema.users.id }).from(schema.users);

  for (const user of users) {
    // The open week, plus the latest closed one. Those two are what the next
    // rollover reads as `prevWeek`.
    const open = await db.query.weekPlans.findMany({
      where: and(
        eq(schema.weekPlans.userId, user.id),
        eq(schema.weekPlans.status, "open")
      ),
      orderBy: asc(schema.weekPlans.weekStart),
    });
    const closed = await db.query.weekPlans.findMany({
      where: and(
        eq(schema.weekPlans.userId, user.id),
        eq(schema.weekPlans.status, "closed")
      ),
      orderBy: desc(schema.weekPlans.weekStart),
      limit: 1,
    });

    for (const week of [...closed, ...open]) {
      const days = week.days as DaySlot[];
      let touched = false;

      const next: DaySlot[] = [];
      for (const day of days) {
        // Already booked (live or by an earlier run) — never double-book.
        if (
          day.activityId != null ||
          day.actualLoad != null ||
          day.unplannedLoad != null
        ) {
          next.push(day);
          continue;
        }

        const dayStart = new Date(day.date + "T00:00:00");
        const dayEnd = new Date(dayStart);
        dayEnd.setDate(dayEnd.getDate() + 1);

        const rows = await db.query.activities.findMany({
          where: and(
            eq(schema.activities.userId, user.id),
            gte(
              sql`coalesce(${schema.activities.startDateLocal}, ${schema.activities.startDate})`,
              dayStart
            ),
            lt(
              sql`coalesce(${schema.activities.startDateLocal}, ${schema.activities.startDate})`,
              dayEnd
            )
          ),
        });
        if (rows.length === 0) {
          next.push(day);
          continue;
        }

        // Collapse the same session synced by two providers before summing.
        const unique = dedupeActivities(
          rows.map((r): LoadActivity & { id: string; sport: string } => ({
            id: r.id,
            provider: r.provider,
            sport: r.sport,
            startDate: r.startDate,
            startDateLocal: r.startDateLocal,
            durationS: r.durationS,
            load: r.load,
            avgHr: r.avgHr,
            avgPower: r.avgPower,
          }))
        ) as (LoadActivity & { id: string; sport: string })[];

        const planned = day.workouts[0] ?? null;
        if (planned) {
          const match = unique.find((a) =>
            sportMatches(planned.sport, a.sport)
          );
          if (!match) {
            next.push(day);
            continue;
          }
          // A matched activity carrying no load books nothing. Live adaptation
          // writes `load ?? 0` here, but a zero-load booking is worse than none
          // in a backfill: it stamps `activityId`, which makes the day look
          // settled and blocks a later re-run from booking the real figure once
          // the provider computes it. Leave it for the next run.
          const load = match.load ?? 0;
          if (load <= 0) {
            skipped.push(
              `${day.date}: matched ${match.provider} activity has no load yet`
            );
            next.push(day);
            continue;
          }
          changes.push({
            weekStart: String(week.weekStart),
            date: day.date,
            field: "actualLoad",
            load,
            from: `${match.provider}/${canonicalSport(match.sport)}`,
          });
          next.push({
            ...recordUnplannedLoad(day, load),
            activityId: match.id,
          });
          touched = true;
          continue;
        }

        // No planned session: every activity that day is unplanned load.
        const load = unique.reduce((s, a) => s + (a.load ?? 0), 0);
        if (load === 0) {
          next.push(day);
          continue;
        }
        changes.push({
          weekStart: String(week.weekStart),
          date: day.date,
          field: "unplannedLoad",
          load,
          from: unique.map((a) => a.provider).join("+"),
        });
        next.push(recordUnplannedLoad(day, load));
        touched = true;
      }

      if (touched && !opts.dryRun) {
        await db
          .update(schema.weekPlans)
          .set({ days: next, updatedAt: new Date() })
          .where(eq(schema.weekPlans.id, week.id));
      }
    }
  }

  return { changes, skipped };
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const userIdx = process.argv.indexOf("--user");
  const userId = userIdx > -1 ? process.argv[userIdx + 1] : undefined;

  const { changes, skipped } = await backfill({ dryRun, userId });

  console.log(dryRun ? "DRY RUN — nothing written\n" : "APPLIED\n");
  for (const c of changes) {
    console.log(
      `  week ${c.weekStart.slice(0, 10)}  ${c.date}  ${c.field} = ${c.load}  (${c.from})`
    );
  }
  if (skipped.length > 0) {
    console.log("\nskipped:");
    for (const s of skipped) console.log(`  ${s}`);
  }
  console.log(`\n${changes.length} day(s) ${dryRun ? "would be" : ""} booked.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

export { backfill };
