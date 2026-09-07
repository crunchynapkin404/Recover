import type { DaySlot } from "./types";
import { plannedMins } from "./fill";

/**
 * The three figures that describe a week before it happens.
 *
 * Owned here rather than computed at each surface, for the reason
 * `docs/specs/2026-08-11-display-derived-figures-ownership-design.md` gives:
 * `NextWeekSummary` derived these inline in its JSX, and the Sunday review
 * needs the same sentence in plain text. Two derivations of one figure is how
 * two surfaces come to disagree about the athlete's own week.
 */
export interface WeekAheadFigures {
  /** Days carrying at least one session. */
  sessions: number;
  /**
   * Days the calendar offers time on that have nothing planned — the
   * actionable half, and the reason to go and look.
   */
  open: number;
  plannedMins: number;
}

export function weekAheadFigures(days: DaySlot[]): WeekAheadFigures {
  return {
    sessions: days.filter((d) => d.workouts.length > 0).length,
    open: days.filter((d) => d.workouts.length === 0 && d.availableMins > 0)
      .length,
    plannedMins: plannedMins(days),
  };
}

/**
 * The same figures as a sentence, for the weekly review's opening line.
 *
 * `targetHours` is omitted when it is null OR zero: a zero target is the
 * ABSENCE of one, and "of 0h target" reads as a claim about the plan rather
 * than as a missing value — the same reasoning, and the same bound, as
 * NextWeekSummary's own `targetHours > 0` check.
 */
export function weekAheadSentence(
  days: DaySlot[],
  targetHours: number | null
): string {
  const { sessions, plannedMins: mins } = weekAheadFigures(days);
  const hours = (mins / 60).toFixed(1);
  const target =
    targetHours != null && targetHours > 0
      ? ` of a ${targetHours.toFixed(1)}h target`
      : "";
  return `${sessions} session${sessions === 1 ? "" : "s"}, ${hours}h planned${target}`;
}
