import type { DayActuals, DaySlot } from "@/lib/week-plan/types";
import { STATUS_DOT, STATUS_LABEL } from "@/lib/status-color";
import { WEEKDAY_SHORT, weekdayIndex } from "@/lib/weekdays";
import {
  DayActions,
  type DayActionsOtherDay,
} from "@/components/week/day-actions";
import {
  NextWeekAvailabilityNote,
  NextWeekDivider,
  NextWeekSummary,
} from "@/components/train/next-week-summary";

function weekdayOf(ymd: string): string {
  // The slot dates are already local Ymd strings; weekdayIndex is Monday-first.
  return WEEKDAY_SHORT[weekdayIndex(ymd)];
}

/**
 * A next-week row is provisional (forecast, not yet materialized) unless the
 * athlete pinned that date's availability with an override — a pin means
 * the day's availableBlocks are real, athlete-set facts, not a projection.
 */
type RowBadge = "provisional" | "pinned" | null;

/** "1:37" — the same compact clock the debrief sheet and activity list use. */
function clock(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.round((secs % 3600) / 60);
  return `${h}:${String(m).padStart(2, "0")}`;
}

interface DayRowProps {
  day: DaySlot;
  isToday: boolean;
  badge: RowBadge;
  otherDays: DayActionsOtherDay[];
  actual?: DayActuals;
}

function DayRow({ day: d, isToday, badge, otherDays, actual }: DayRowProps) {
  // Only for days the plan left empty. A planned session that happened
  // already says so through its own "completed" chip, and repeating the
  // ride underneath it would be the same duplicated-data problem this
  // project has had to undo on page after page.
  const credit =
    actual && actual.count > 0 && d.workouts.length === 0 && d.status !== "race"
      ? actual
      : null;
  const provisional = badge === "provisional";
  return (
    <div
      data-date={d.date}
      data-today={isToday ? "" : undefined}
      className={`border-b border-hairline px-4 py-3.5 last:border-0 ${
        isToday ? "bg-surface-overlay" : ""
      }`}
    >
      <div className="flex items-center gap-3">
        <span
          className={`w-10 shrink-0 text-label font-bold uppercase tracking-[0.15em] ${
            isToday ? "text-ink-secondary" : "text-ink-muted"
          }`}
        >
          {weekdayOf(d.date)}
        </span>

        <span
          data-status={d.status}
          title={STATUS_LABEL[d.status]}
          className={`size-2.5 shrink-0 rounded-full ${STATUS_DOT[d.status]}`}
        >
          <span className="sr-only">{STATUS_LABEL[d.status]}</span>
        </span>

        <div className="min-w-0 flex-1">
          {d.workouts.length > 0 ? (
            d.workouts.map((w, i) => (
              <p
                key={i}
                className={`truncate text-caption ${isToday ? "font-bold text-ink-primary" : "text-ink-secondary"}`}
              >
                {`${w.type} · ${provisional ? "~" : ""}${w.durationMins} min`}
                <span className="ml-1.5 font-normal text-ink-muted">
                  {w.intensity}
                </span>
              </p>
            ))
          ) : d.status === "race" ? (
            <p className="truncate text-caption font-bold text-ink-race">
              <span aria-hidden>🏁 </span>
              {d.raceName ?? "Race day"}
            </p>
          ) : (
            <p className="text-caption text-ink-muted">
              Rest
              <span className="ml-1.5 text-ink-muted">
                {`${provisional ? "~" : ""}${d.availableMins} min free`}
              </span>
            </p>
          )}
          {credit && (
            <p className="mt-0.5 text-label text-chart-2">
              <span aria-hidden>✓ </span>
              {`${credit.count} session${credit.count === 1 ? "" : "s"} · ${clock(
                credit.secs
              )}`}
              {credit.load > 0 && ` · ${Math.round(credit.load)} load`}
            </p>
          )}
          {d.movedFrom && (
            <p className="mt-0.5 text-label text-chart-3">
              {`moved from ${weekdayOf(d.movedFrom)}`}
            </p>
          )}
        </div>

        {badge && (
          <span className="shrink-0 rounded-full border border-hairline px-2 py-0.5 text-label font-bold uppercase tracking-wider text-ink-muted">
            {badge}
          </span>
        )}
      </div>

      {isToday && d.workouts.length > 0 && (
        <DayActions
          day={{ date: d.date, workoutCount: d.workouts.length }}
          otherDays={otherDays.filter((o) => o.date !== d.date)}
        />
      )}
    </div>
  );
}

/**
 * The week as one grouped surface with hairline rows (1c) — replacing the
 * seven separate glass cards. Today's row is highlighted and is the only
 * one that carries its move/swap/skip actions inline; the rest stay a
 * scannable list.
 *
 * A ROLLING schedule, not a fixed Monday-first week: days before `today`
 * are dropped (already happened, no longer part of what's ahead), `today`
 * itself is never dropped even if it's already complete — an athlete
 * opening the app at 20:00 must still see what today asked of them. When
 * `nextWeek` is supplied (docs/plans/2026-07-29-next-week-preview.md, Task
 * 4), its days no longer render as seven more full rows: `NextWeekSummary`
 * (v0.99 slice 2 Task 4) collapses them to one summary row behind a closed
 * `<details>` — a forecast, not a commitment, so it does not double the
 * tab's scroll length the way seven expanded rows did. Each day is still
 * marked "provisional" with a `~` before its durations once expanded,
 * except where the athlete pinned that date's availability with an
 * override, which makes it a real fact rather than a projection.
 *
 * NOTE: `WeekRationale`, adherence and the weekly review stay Monday–Sunday
 * accounting for the week that's closing; this component is schedule, not
 * accounting, and is the only one that rolls.
 *
 * NOTE: the v0.21 /plan page put DayActions on every day that had a
 * workout, so a future day could be rescheduled directly from its own row.
 * The 1c mockup shows the action pills only under today. Dropping the
 * `isToday &&` guard below restores the old reach if that turns out to
 * matter more than the quieter list.
 */
export function WeekDayList({
  days,
  today,
  nextWeek,
  actuals,
}: {
  days: DaySlot[];
  today: string;
  nextWeek?: {
    days: DaySlot[];
    pinned: Record<string, boolean>;
    /** Next week's target in hours, for the summary line; null when unknown. */
    targetHours: number | null;
    /** Where the summary's availability link points. Required — see NextWeekSummary. */
    availabilityHref: string;
  } | null;
  /**
   * What was actually trained, keyed by local Ymd. Read straight from the
   * activities table rather than from the day slot's own `unplannedLoad`,
   * which `runDailyAdaptation` only writes the FOLLOWING day — today's ride
   * has to be visible on today's row, which is the whole point.
   */
  actuals?: Record<string, DayActuals>;
}) {
  // Ymd strings compare lexicographically the same as chronologically —
  // the convention already used for this in replan.ts and service.ts.
  const visibleDays = days.filter((d) => d.date >= today);

  // Built from visibleDays, not the raw `days` prop: a dropped (past) day
  // must never surface as a move/swap target in today's DayActions either
  // — DayActions itself only filters by workoutCount/isRace, trusting the
  // caller for "target days are always inside the open week" (its own
  // comment), so a rest day before today would otherwise leak back in
  // through the Target day dropdown even though its row is gone.
  const otherDays: DayActionsOtherDay[] = visibleDays.map((o) => ({
    date: o.date,
    workoutCount: o.workouts.length,
    isRace: o.status === "race",
  }));

  const nextWeekHasAvailability =
    nextWeek != null &&
    nextWeek.days.some((d) => d.workouts.length > 0 || d.availableMins > 0);

  return (
    <section className="glass mb-5 overflow-hidden rounded-[18px]">
      {visibleDays.map((d) => (
        <DayRow
          key={d.date}
          day={d}
          isToday={d.date === today}
          badge={null}
          otherDays={otherDays}
          actual={actuals?.[d.date]}
        />
      ))}

      {nextWeek &&
        (nextWeekHasAvailability ? (
          <NextWeekSummary
            days={nextWeek.days}
            pinned={nextWeek.pinned}
            targetHours={nextWeek.targetHours}
            availabilityHref={nextWeek.availabilityHref}
          >
            {nextWeek.days.map((d) => (
              <DayRow
                key={d.date}
                day={d}
                isToday={false}
                badge={nextWeek.pinned[d.date] ? "pinned" : "provisional"}
                otherDays={otherDays}
              />
            ))}
          </NextWeekSummary>
        ) : (
          <>
            <NextWeekDivider />
            <div className="px-4 py-3 text-caption text-ink-muted">
              No availability set for next week
            </div>
            {/* This is the branch the link matters most in — the athlete
                has nothing set yet, so this is the one dead end that would
                actually strand them (Finding 1, Task 12 fix pass). */}
            <NextWeekAvailabilityNote
              availabilityHref={nextWeek.availabilityHref}
            />
          </>
        ))}
    </section>
  );
}
