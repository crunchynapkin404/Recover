// v0.20 weekly availability prompt: nudge the athlete to confirm their week's
// training time, and stop nagging once they have (or once it's too late for
// the nudge to be useful).
import { and, eq, inArray } from "drizzle-orm";
import { getOpenWeekPlan } from "./service";
import { db, schema } from "@/lib/db";
import { sendToUser } from "@/lib/push";
import { logger } from "@/lib/logger";

/** Past this many days into the week, nagging is worse than silence. */
const PROMPT_WINDOW_DAYS = 4;

function daysBetween(from: string, to: string): number {
  return Math.round(
    (new Date(to + "T00:00:00").getTime() -
      new Date(from + "T00:00:00").getTime()) /
      86_400_000
  );
}

function localYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Pure. A confirmation counts only when it was made during the week it
 * confirms — last week's tick must not silence this week.
 *
 * confirmedYmd must be derived from the *local* calendar day (via
 * localYmd), matching weekStart/today. The app runs under
 * TZ=Europe/Amsterdam; a confirmation made between local midnight and the
 * UTC offset boundary would land on the previous UTC date, so deriving it
 * with confirmedAt.toISOString() would wrongly read as belonging to last
 * week and re-trigger the prompt on the very day the athlete confirmed.
 */
export function shouldPromptAvailability(input: {
  confirmedAt: Date | null;
  promptedAt: Date | null;
  weekStart: string;
  today: string;
}): boolean {
  const age = daysBetween(input.weekStart, input.today);
  if (age < 0 || age > PROMPT_WINDOW_DAYS) return false;
  // Already nudged for THIS week — the window spans five days and the
  // scheduler runs daily, so without this the athlete who does not confirm
  // is pushed every one of them. A stale timestamp from an earlier week
  // (rows are per user-week, but a week can be re-opened) does not count.
  if (
    input.promptedAt != null &&
    localYmd(input.promptedAt) >= input.weekStart
  ) {
    return false;
  }
  if (input.confirmedAt == null) return true;
  const confirmedYmd = localYmd(input.confirmedAt);
  return confirmedYmd < input.weekStart;
}

/**
 * The Sunday nudge (v0.123): ask about the week that is ABOUT to start, on
 * the last day of the one running.
 *
 * Pure, and separate from `shouldPromptAvailability` rather than folded into
 * its window, because the two ask about different weeks and answer to
 * different evidence. The v0.20 prompt asks "have you confirmed the week you
 * are in", and its answer lives on that week's `weekPlans` row. This one asks
 * "have you told me anything about next week at all", and next week has no
 * row yet on a Sunday — the answer is whether any `availability_overrides`
 * exist for its dates.
 *
 * Why one day and not a window: the standard week was the thing that made a
 * late nudge tolerable, and the athlete reports overriding it every week, so
 * there is no useful default to fall back on. Asking on Sunday is asking at
 * the only moment where the answer can still shape Monday. Missing it is
 * covered by the existing Monday-to-Friday prompt, which still runs.
 *
 * ONE TOUCHED DAY IS ENOUGH TO STOP IT. An athlete who has set three of seven
 * days has engaged with next week deliberately; nudging them to finish is
 * nagging about a judgement they already made.
 */
export function shouldPromptNextWeekAvailability(input: {
  /** How many of next week's dates already carry an availability override. */
  overriddenDates: number;
  promptedAt: Date | null;
  /** The Monday about to start. */
  nextWeekStart: string;
  /** Today, as a LOCAL calendar day (see localYmd). */
  today: string;
}): boolean {
  // Exactly the day before, never a window — see the doc comment.
  if (daysBetween(input.today, input.nextWeekStart) !== 1) return false;
  if (input.overriddenDates > 0) return false;
  // Local, not UTC: a nudge sent at 00:30 Amsterdam time is 22:30 UTC the
  // previous day, and toISOString() would license a second push the same
  // Sunday. The v0.20 prompt documents this defect class for confirmations.
  if (input.promptedAt != null && localYmd(input.promptedAt) === input.today) {
    return false;
  }
  return true;
}

/**
 * Sends the weekly "confirm your availability" nudge when the open week is
 * unconfirmed (or confirmed under a stale, earlier week) and still within
 * the prompt window. No-ops when there is no open week at all.
 */
export async function promptAvailability(
  userId: string,
  now = new Date()
): Promise<"sent" | "skipped"> {
  const week = await getOpenWeekPlan(userId);
  if (!week) return "skipped";
  if (
    !shouldPromptAvailability({
      confirmedAt: week.availabilityConfirmedAt,
      promptedAt: week.availabilityPromptedAt,
      weekStart: week.weekStart,
      today: localYmd(now),
    })
  ) {
    return "skipped";
  }

  // Recorded BEFORE the push: a send that throws half-way (or a push service
  // that is briefly down) must not license a retry on every remaining day of
  // the window. One missed nudge beats five delivered ones.
  await db
    .update(schema.weekPlans)
    .set({ availabilityPromptedAt: now })
    .where(eq(schema.weekPlans.id, week.id));

  const { sent, pruned } = await sendToUser(userId, {
    title: "How's your week looking?",
    body: "Confirm your training time so this week plans itself around it.",
    tag: "availability-prompt",
    url: "/train",
  });
  logger.info("availability prompt push", { userId, sent, pruned });
  return "sent";
}

/** The seven dates of the week starting `weekStart`, as local calendar days. */
function datesOfWeek(weekStart: string): string[] {
  const start = new Date(weekStart + "T00:00:00");
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    return localYmd(d);
  });
}

/**
 * Sends the Sunday nudge about next week, once, when nothing about next week
 * has been set yet.
 *
 * Deep-links to `/train?availability=next` rather than `/train`: the
 * availability switcher already reads that param on a fresh load (see
 * `initialAvailabilityMode` in train/page.tsx), so the athlete lands on the
 * control this notification is about instead of on the page that contains it.
 *
 * No-ops without an open week, matching promptAvailability. An athlete with
 * no plan at all has no "next week" to shape, and inventing one from a push
 * notification is not this function's job.
 */
export async function promptNextWeekAvailability(
  userId: string,
  now = new Date()
): Promise<"sent" | "skipped"> {
  const week = await getOpenWeekPlan(userId);
  if (!week) return "skipped";

  const nextWeekStart = localYmd(
    new Date(new Date(week.weekStart + "T00:00:00").getTime() + 7 * 86_400_000)
  );
  const dates = datesOfWeek(nextWeekStart);
  const overrides = await db.query.availabilityOverrides.findMany({
    where: and(
      eq(schema.availabilityOverrides.userId, userId),
      inArray(schema.availabilityOverrides.date, dates)
    ),
    columns: { date: true },
  });

  if (
    !shouldPromptNextWeekAvailability({
      overriddenDates: overrides.length,
      promptedAt: week.nextWeekPromptedAt,
      nextWeekStart,
      today: localYmd(now),
    })
  ) {
    return "skipped";
  }

  // Recorded before the push, for the reason promptAvailability records its
  // own: a send that throws must not license a retry, and this one has only a
  // single day to be retried within.
  await db
    .update(schema.weekPlans)
    .set({ nextWeekPromptedAt: now })
    .where(eq(schema.weekPlans.id, week.id));

  const { sent, pruned } = await sendToUser(userId, {
    title: "Next week starts tomorrow",
    body: "Set the time you'll have and the week plans itself around it.",
    tag: "next-week-availability",
    url: "/train?availability=next",
  });
  logger.info("next week availability prompt push", { userId, sent, pruned });
  return "sent";
}
