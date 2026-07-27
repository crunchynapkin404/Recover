// src/lib/availability/resolve.ts
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { resolveDay } from "./resolve-day";
import type { AvailabilityBlock } from "./types";

/** Monday = 0, matching availability_defaults.weekday. */
function weekdayOf(ymd: string): number {
  return (new Date(ymd + "T00:00:00").getDay() + 6) % 7;
}

/**
 * Resolved availability for each requested date. Two queries: the seven
 * defaults, and the overrides for exactly these dates.
 */
export async function resolveWeek(
  userId: string,
  dates: string[]
): Promise<Map<string, AvailabilityBlock[]>> {
  const [defaults, overrides] = await Promise.all([
    db.query.availabilityDefaults.findMany({
      where: eq(schema.availabilityDefaults.userId, userId),
    }),
    dates.length > 0
      ? db.query.availabilityOverrides.findMany({
          where: and(
            eq(schema.availabilityOverrides.userId, userId),
            inArray(schema.availabilityOverrides.date, dates)
          ),
        })
      : Promise.resolve([]),
  ]);

  const byWeekday = new Map<number, AvailabilityBlock[]>(
    defaults.map((d) => [d.weekday, d.blocks as AvailabilityBlock[]])
  );
  const byDate = new Map<string, AvailabilityBlock[]>(
    overrides.map((o) => [o.date, o.blocks as AvailabilityBlock[]])
  );

  return new Map(
    dates.map((date) => [
      date,
      resolveDay(
        byWeekday.get(weekdayOf(date)) ?? [],
        byDate.get(date) ?? null
      ),
    ])
  );
}
