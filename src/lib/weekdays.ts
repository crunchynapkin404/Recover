/**
 * The app's weekday vocabulary, at the four lengths its surfaces use.
 *
 * ALL FOUR ARE MONDAY-FIRST, which is the app's week everywhere — plan
 * weeks, availability defaults, the week strip and the standard week all
 * index day 0 as Monday. Use `weekdayIndex` to get that index from a date
 * rather than reaching for `getDay()`, which is Sunday-first and was the
 * source of the one off-by-origin copy this module replaced.
 *
 * There were six copies across three lengths and no canonical home: two
 * full-name arrays in components plus a third in an MCP tool, two
 * "Mon"–"Sun" arrays, and a "Mo"–"Su" array — none of which could be
 * changed without hunting the others.
 */
export const WEEKDAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

/** "Mon" — day-list rows and the availability form's column heads. */
export const WEEKDAY_SHORT = [
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
  "Sun",
] as const;

/**
 * "Mo" — the week strip, where seven labels share a phone's width.
 * Two characters, not one: at the 12px floor the single-letter set collided
 * into "MOTUWETHFRSASU" whenever the strip was squeezed (see week-strip.tsx).
 */
export const WEEKDAY_NARROW = [
  "Mo",
  "Tu",
  "We",
  "Th",
  "Fr",
  "Sa",
  "Su",
] as const;

/** "M" — only where a cell is too narrow for two, as in the sleep strip. */
export const WEEKDAY_INITIAL = ["M", "T", "W", "T", "F", "S", "S"] as const;

/**
 * Monday-first index (Mon = 0) for a local `YYYY-MM-DD`.
 *
 * Constructed as UTC and read back as UTC: a local-time Date here would
 * shift the weekday for anyone east or west of the server.
 */
export function weekdayIndex(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}
