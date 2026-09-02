/**
 * "Yes, this was my planned session" → the day is done.
 *
 * A thin resolver, and thin on purpose: it turns an activity id into the
 * LOCAL day it happened on and hands that to `markDayDone`, which already
 * owns every refusal (no open week, no workout that day, already completed
 * or missed, a race day) and whose doc records that v0.44 had to fix load
 * booking for exactly that button. A second status write here would have to
 * re-earn all of it.
 *
 * `startDateLocal ?? startDate` is the same coalesce the race debrief uses:
 * `startDateLocal` is nullable and not yet backfilled, and the athlete's
 * wall-clock day is the one their plan is written in.
 */
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { markDayDone } from "./service";

function localYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Which day of the athlete's plan an activity belongs to.
 *
 * Exported so it can be tested for the case that actually matters and that an
 * integration test cannot reach cheaply: a late-evening ride whose UTC date is
 * already tomorrow. Reading `startDate` there completes the WRONG day, and a
 * test that only asserts "the resolver got as far as markDayDone" passes
 * either way — which is exactly what the first version of this test did.
 */
export function planDayOfActivity(activity: {
  startDate: Date;
  startDateLocal: Date | null;
}): string {
  return localYmd(activity.startDateLocal ?? activity.startDate);
}

export async function markDayDoneForActivity(
  userId: string,
  activityId: string
): Promise<"completed" | "no_open_week" | "invalid" | "no_activity"> {
  const activity = await db.query.activities.findFirst({
    where: and(
      eq(schema.activities.id, activityId),
      eq(schema.activities.userId, userId)
    ),
    columns: { startDate: true, startDateLocal: true },
  });
  if (!activity) return "no_activity";
  return markDayDone(userId, planDayOfActivity(activity));
}
