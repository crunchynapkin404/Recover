/**
 * v0.35 sleep history selection.
 *
 * The Sleep tab used to render only the newest night with a duration. That
 * broke down once stages started arriving from intervals.icu, because the
 * Companion writes a night's native fields before its stages — so the newest
 * night is routinely the one night without them, while complete nights sit
 * just behind it.
 *
 * Pure on purpose: the strip and the prev/next arrows both navigate by this
 * function's output, so their agreement is a property that can be tested
 * rather than something to eyeball in a browser.
 */

/**
 * How many nights the history strip offers.
 * Source: Invented — a UI display-amount choice, not cited research.
 * Confidence: Low.
 */
export const SLEEP_HISTORY_NIGHTS = 14;

export interface SelectedNights<T> {
  /** The night to display, or null when nothing has been recorded. */
  selected: T | null;
  /** Strip contents, oldest → newest, capped at SLEEP_HISTORY_NIGHTS. */
  recent: T[];
  /** `selected`'s position in `recent`; -1 when there is nothing to show. */
  index: number;
}

/**
 * Pick the night to display and the window of nights to offer.
 *
 * `requested` is raw URL input and is treated as untrusted: it selects a night
 * only by matching one already loaded, and is never used to build a query.
 * Anything unrecognised falls back to the newest night.
 */
export function selectNight<
  T extends { date: string; sleepSecs: number | null },
>(nights: T[], requested: string | undefined): SelectedNights<T> {
  // Only nights with a duration are navigable — an empty night has nothing to
  // show, and including them would create dead cells in the strip and dead
  // steps for the arrows.
  const recorded = nights.filter((n) => n.sleepSecs != null);
  const recent = recorded.slice(-SLEEP_HISTORY_NIGHTS);

  if (recent.length === 0) return { selected: null, recent: [], index: -1 };

  const wanted =
    requested && /^\d{4}-\d{2}-\d{2}$/.test(requested)
      ? recent.findIndex((n) => n.date === requested)
      : -1;

  const index = wanted >= 0 ? wanted : recent.length - 1;
  return { selected: recent[index], recent, index };
}
