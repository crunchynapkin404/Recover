// v0.20 weekly availability prompt: nudge the athlete to confirm their week's
// training time, and stop nagging once they have (or once it's too late for
// the nudge to be useful).
import { getOpenWeekPlan } from "./service";
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
  weekStart: string;
  today: string;
}): boolean {
  const age = daysBetween(input.weekStart, input.today);
  if (age < 0 || age > PROMPT_WINDOW_DAYS) return false;
  if (input.confirmedAt == null) return true;
  const confirmedYmd = localYmd(input.confirmedAt);
  return confirmedYmd < input.weekStart;
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
      weekStart: week.weekStart,
      today: localYmd(now),
    })
  ) {
    return "skipped";
  }
  const { sent, pruned } = await sendToUser(userId, {
    title: "How's your week looking?",
    body: "Confirm your training time so this week plans itself around it.",
    tag: "availability-prompt",
    url: "/train",
  });
  logger.info("availability prompt push", { userId, sent, pruned });
  return "sent";
}
