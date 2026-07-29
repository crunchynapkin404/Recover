import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { addDaysYmd, getOpenWeekPlan } from "@/lib/week-plan/service";
import { resolveDay } from "./resolve-day";
import type { AvailabilityBlock } from "./types";

/** Monday = 0, matching availability_defaults.weekday. */
function weekdayOf(ymd: string): number {
  return (new Date(ymd + "T00:00:00").getDay() + 6) % 7;
}

/**
 * True when two block lists are the same availability value: same length,
 * and every block equal on every field the athlete can actually set.
 * `sports: null` ("any sport") and `sports: []` ("admits nothing") are
 * deliberately never equal to each other — collapsing them would let a
 * day pinned "no sport allowed" silently re-merge with a weekday default
 * that means "anything goes".
 *
 * Pure and exported for its own tests.
 */
export function blocksEqual(
  a: AvailabilityBlock[],
  b: AvailabilityBlock[]
): boolean {
  if (a.length !== b.length) return false;
  return a.every((block, i) => oneBlockEqual(block, b[i]));
}

function oneBlockEqual(a: AvailabilityBlock, b: AvailabilityBlock): boolean {
  return (
    a.start === b.start &&
    a.end === b.end &&
    a.mins === b.mins &&
    a.energy === b.energy &&
    sportsEqual(a.sports, b.sports)
  );
}

/**
 * Sports are a set, not a sequence: the editor emits a stable order but
 * set_standard_week lets an LLM choose its own, so a coach writing
 * ["Bike","Run"] against a UI-written ["Run","Bike"] would otherwise read as
 * a difference and pin a date that in fact matches the standard week.
 */
function sportsEqual(a: string[] | null, b: string[] | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((s, i) => s === sortedB[i]);
}

/**
 * Keeps each date's override row honest with what was actually submitted.
 * A day whose blocks now differ from its weekday default is pinned, so the
 * edit survives the next re-materialization — the whole reason the override
 * table exists. A day that now matches the default again has its pin
 * removed, so editing a day back to standard is as valid a way to return it
 * to the standard week as the "Pinned" badge's own clear action.
 *
 * Skips any date the open week already marks completed or missed — those
 * are already lived, and a form resubmission must not retroactively pin
 * them. Never reads or writes availability_defaults itself beyond looking
 * up what it would resolve to; the standard week is never touched here.
 *
 * Lives here rather than beside the server action because BOTH writers need
 * it: the athlete's form and the coach's set_week_availability tool. Calling
 * applyAvailability without this leaves the open week's jsonb changed but
 * nothing pinned, so the change is invisible to resolveWeek and dies at the
 * next rematerialization.
 */
export async function syncDateOverrides(
  userId: string,
  blocksPerDay: AvailabilityBlock[][],
  weekStart?: string
): Promise<void> {
  // Which seven dates are we writing, and which of them may be skipped?
  //
  // With no `weekStart` this is the open week, exactly as before: its own
  // stored days, and completed/missed ones are left alone because their
  // availability is now historical fact.
  //
  // With a `weekStart` — a future week — there is no stored row and nothing
  // is settled, so all seven dates are writable. `availability_overrides` is
  // keyed by date and `resolveWeek` takes arbitrary dates, so nothing else
  // has to change for a week that does not exist yet.
  let dates: string[];
  let skippable: Set<string>;
  if (weekStart) {
    dates = Array.from({ length: 7 }, (_, i) => addDaysYmd(weekStart, i));
    skippable = new Set();
  } else {
    const week = await getOpenWeekPlan(userId);
    if (!week) return;
    dates = week.days.map((d) => d.date);
    skippable = new Set(
      week.days
        .filter((d) => d.status === "completed" || d.status === "missed")
        .map((d) => d.date)
    );
  }

  const defaults = await db.query.availabilityDefaults.findMany({
    where: eq(schema.availabilityDefaults.userId, userId),
  });
  const byWeekday = new Map<number, AvailabilityBlock[]>(
    defaults.map((d) => [d.weekday, d.blocks as AvailabilityBlock[]])
  );

  for (let i = 0; i < dates.length; i++) {
    const date = dates[i];
    if (skippable.has(date)) continue;

    const submitted = blocksPerDay[i] ?? [];
    const standard = resolveDay(byWeekday.get(weekdayOf(date)) ?? [], null);

    if (blocksEqual(submitted, standard)) {
      await db
        .delete(schema.availabilityOverrides)
        .where(
          and(
            eq(schema.availabilityOverrides.userId, userId),
            eq(schema.availabilityOverrides.date, date)
          )
        );
    } else {
      await db
        .insert(schema.availabilityOverrides)
        .values({ userId, date, blocks: submitted })
        .onConflictDoUpdate({
          target: [
            schema.availabilityOverrides.userId,
            schema.availabilityOverrides.date,
          ],
          set: { blocks: submitted, updatedAt: new Date() },
        });
    }
  }
}
