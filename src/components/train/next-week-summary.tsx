import type { DaySlot } from "@/lib/week-plan/types";
import { plannedMins } from "@/lib/week-plan/fill";

/**
 * The "Next week" label row — shared by the collapsed summary below and
 * week-day-list.tsx's no-availability branch, so the two cannot drift.
 */
export function NextWeekDivider() {
  return (
    <div className="border-b border-hairline bg-surface-overlay px-4 py-2 text-center text-label font-bold uppercase tracking-[0.2em] text-ink-muted last:border-0">
      Next week
    </div>
  );
}

/**
 * Next week, collapsed to one row (v0.99 slice 2).
 *
 * Seven more full day rows — each provisional, each with its own badge —
 * roughly doubled the scroll length of the app's most-visited tab for data
 * that is a forecast, not a commitment. This is the demotion: the summary
 * is always visible, the days are one tap away, and nothing is removed.
 * Committed data (this week) is untouched and stays fully expanded.
 *
 * A native <details> rather than the base-ui Collapsible: this renders
 * inside a server component, and the disclosure needs no JavaScript to
 * work. races-section.tsx already uses the same element twice.
 *
 * Every figure here is computed by the same producers page.tsx calls for
 * the note beneath the list, so the two can never disagree.
 */
export function NextWeekSummary({
  days,
  pinned,
  targetHours,
  children,
}: {
  days: DaySlot[];
  pinned: Record<string, boolean>;
  targetHours: number | null;
  children: React.ReactNode;
}) {
  const sessions = days.filter((d) => d.workouts.length > 0).length;
  // "Open" is a day the calendar offers time on that has nothing planned —
  // the actionable half of the summary, and the reason to tap through.
  const open = days.filter(
    (d) => d.workouts.length === 0 && d.availableMins > 0
  ).length;
  const plannedHours = plannedMins(days) / 60;
  const provisional = days.some((d) => !pinned[d.date]);

  return (
    <>
      <NextWeekDivider />
      <details>
        <summary className="cursor-pointer list-none px-4 py-3 text-caption text-ink-secondary">
          {provisional && (
            <span aria-hidden className="mr-1.5 text-ink-muted">
              ~
            </span>
          )}
          <span className="sr-only">{provisional ? "Provisional: " : ""}</span>
          {`${sessions} session${sessions === 1 ? "" : "s"} planned, ${open} open · ${plannedHours.toFixed(1)}h planned`}
          {/* `> 0`, not just non-null: a zero target is the absence of one,
              and "of 0h target" reads as a claim about the plan rather than
              as a missing value. */}
          {targetHours != null &&
            targetHours > 0 &&
            ` of ${targetHours}h target`}
          <span className="mt-1 block text-label font-bold text-accent">
            {`Show all ${days.length} days${provisional ? " (provisional)" : ""} →`}
          </span>
        </summary>
        {children}
      </details>
    </>
  );
}
