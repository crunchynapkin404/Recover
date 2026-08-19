import type { DayStatus } from "@/lib/week-plan/types";

/**
 * A planned day's status as a DOT fill. Non-text, so the 3:1 minimum
 * applies, not 4.5:1 — same rule as BAND_DOT in band-color.ts.
 *
 * Shared by every surface that paints a day's status, so a status never
 * means two colours. It was two identical maps: `week-strip.tsx` and
 * `week-day-list.tsx` render the same seven days one above the other on
 * Train → Week, and each carried a comment promising to keep its copy in
 * sync with the other by hand. That promise is now a shared import.
 *
 * Repo avoids blue for accents: chart-2 = done, chart-3 = changed,
 * chart-5 = missed, muted ink = rest/planned.
 */
export const STATUS_DOT: Record<DayStatus, string> = {
  completed: "bg-chart-2",
  adapted: "bg-chart-3",
  moved: "bg-chart-3",
  missed: "bg-chart-5",
  planned: "bg-ink-muted",
  rest: "bg-hairline opacity-40",
  race: "bg-ink-race",
};

/** The status in one word — the dot's accessible name and its title. */
export const STATUS_LABEL: Record<DayStatus, string> = {
  completed: "Completed",
  adapted: "Adapted",
  moved: "Moved",
  missed: "Missed",
  planned: "Planned",
  rest: "Rest",
  race: "Race day",
};
