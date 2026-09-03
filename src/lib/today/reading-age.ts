/**
 * How old is the readiness figure the hero is about to show?
 *
 * Today's hero does NOT necessarily show today's reading. `page.tsx` walks
 * backwards through a THIRTY-DAY window of daily_metrics for the first row
 * with a non-null readiness, so an athlete who has not synced since Monday
 * sees Monday's score — and before this module existed, saw it unmarked.
 *
 * The card's previous staleness marker keyed on TIME OF DAY (a "compact
 * recap" variant in the evening and post-session states), which is a proxy
 * for the wrong thing: it fired at 18:00 on a reading taken that same
 * morning, and never fired at 07:00 on a reading three weeks old. This keys
 * on the fact instead — the date the reading actually describes.
 *
 * Pure, and takes both dates as arguments rather than reading a clock, so
 * every case above is testable without freezing time.
 */

/** Weekday names, indexed by `Date.getUTCDay()`. */
const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * A phrase naming when the reading is from, or `null` when it is today's.
 *
 * Both arguments are local calendar dates as `YYYY-MM-DD` — the same shape
 * `daily_metrics.date` stores and `todayDate` already carries on Today.
 * They are compared as UTC midnights, which is safe precisely BECAUSE both
 * sides are already local dates: no timezone is applied to either, so the
 * difference is a count of calendar days and never shifts by an hour.
 */
export function describeReadingAge(
  readingDate: string | null | undefined,
  todayDate: string
): string | null {
  if (!readingDate) return null;
  if (readingDate === todayDate) return null;

  const reading = Date.parse(`${readingDate}T00:00:00Z`);
  const today = Date.parse(`${todayDate}T00:00:00Z`);
  if (Number.isNaN(reading) || Number.isNaN(today)) return null;

  const days = Math.round((today - reading) / MS_PER_DAY);

  // A reading dated in the future is clock skew or a mis-stored date, not
  // staleness. Saying nothing is honest; "in 2 days" would not be.
  if (days <= 0) return null;

  if (days === 1) return "yesterday";

  // Inside a week a weekday is something an athlete can place. At seven days
  // the name wraps to the same weekday and stops disambiguating, so the
  // count takes over.
  if (days < 7) return WEEKDAYS[new Date(reading).getUTCDay()];

  return `${days} days ago`;
}
