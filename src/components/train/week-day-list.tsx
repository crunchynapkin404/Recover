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
import { WorkoutProfile } from "@/components/train/workout-profile";
import type { DayWorkout } from "@/lib/interval/for-day";

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
  /**
   * Whether this is the day the athlete has open — Train's `?day=`
   * (openDayFrom), not necessarily the real calendar date. Renamed from the
   * pre-Task-4 `isToday`: only ONE row from the current week ever renders
   * now (WeekDayList below), and it always passes `isOpen` — so this flag's
   * only remaining job is telling the open row apart from a next-week
   * preview row, which always passes `isOpen={false}`.
   */
  isOpen: boolean;
  /**
   * The structured workout for each of this day's sessions, by index, where
   * the library answers one. Resolved on the SERVER — LIBRARY is thirty
   * workouts of data and none of it belongs in the client bundle.
   *
   * Absent, or a null entry, means the library refused: no sport match, no
   * purpose it answers, or nothing that fits the length. The row then renders
   * exactly what it rendered before this feature existed, which is the whole
   * of the fallback.
   */
  structured?: (DayWorkout | null)[];
  badge: RowBadge;
  otherDays: DayActionsOtherDay[];
  actual?: DayActuals;
  /**
   * I4, final whole-branch review: whether the open day's own actions
   * (Move, Target day, What if?, No time today) can possibly succeed.
   * Before Task 4, `visibleDays = days.filter(d => d.date >= today)` meant
   * a past day had no row at all, so DayActions never got the chance to
   * mount on one; the day strip now makes every day a tap away, and this
   * is what restores the same floor. False on a day the athlete has
   * already completed or missed (moveWorkout/swapWorkouts refuse those as
   * a source; zeroDay has no such guard of its own and would happily pin a
   * zero-availability override onto a day already trained) or that is
   * simply in the past (a day the daily adaptation never got to still
   * reads "planned" forever — see verdict-line.ts's I3 fix for the same
   * gap). Only WeekDayList computes this, since only it has `today` in
   * scope; a next-week preview row always passes `isOpen={false}`, so this
   * prop is moot there and defaults true.
   */
  actionable?: boolean;
}

function DayRow({
  day: d,
  isOpen,
  structured,
  badge,
  otherDays,
  actual,
  actionable = true,
}: DayRowProps) {
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
      data-open={isOpen ? "" : undefined}
      className={`border-b border-hairline px-4 py-3.5 last:border-0 ${
        isOpen ? "bg-surface-overlay" : ""
      }`}
    >
      <div className="flex items-center gap-3">
        <span
          className={`w-10 shrink-0 text-label font-bold uppercase tracking-[0.15em] ${
            isOpen ? "text-ink-secondary" : "text-ink-muted"
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
              <div key={i}>
                <p
                  className={`truncate text-caption ${isOpen ? "font-bold text-ink-primary" : "text-ink-secondary"}`}
                >
                  {`${w.type} · ${provisional ? "~" : ""}${w.durationMins} min`}
                  <span className="ml-1.5 font-normal text-ink-muted">
                    {w.intensity}
                  </span>
                </p>
                {w.exercises && w.exercises.length > 0 && (
                  <p className="mt-0.5 truncate text-label text-ink-muted">
                    {w.description}
                  </p>
                )}
                {isOpen && structured?.[i] && (
                  <div data-structured-workout>
                    <p className="mt-0.5 text-label font-bold text-ink-secondary">
                      {structured[i]!.workout.name}
                    </p>
                    <p className="mt-0.5 text-label text-ink-muted">
                      {structured[i]!.description}
                    </p>
                    <WorkoutProfile
                      bars={structured[i]!.profile}
                      label={structured[i]!.description}
                    />
                  </div>
                )}
              </div>
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

      {isOpen && actionable && d.workouts.length > 0 && (
        <DayActions
          day={{ date: d.date, workoutCount: d.workouts.length }}
          otherDays={otherDays.filter((o) => o.date !== d.date)}
        />
      )}
    </div>
  );
}

/**
 * The week as ONE open day (Task 4) — replacing the seven-row rolling list
 * that used to sit above the next-week summary. `openDate` (from Train's
 * `?day=`, resolved by openDayFrom so it always names a real day of `days`)
 * is the only row rendered from the current week; the day strip above this
 * component (WeekStrip, Task 3) is now the only way to move between days.
 * Whatever styling and behaviour used to be exclusive to `isToday` — the
 * highlight, the bold session line, and DayActions (move/swap/skip) — now
 * belongs to the open day instead, even when it isn't literally today: see
 * DayRow's `isOpen` doc comment.
 *
 * `today` (the real calendar date) still does two things that are
 * independent of which day is open: it is the floor for `otherDays`, the
 * DayActions "Target day" list, so a workout can never be moved onto a day
 * that has already passed — see the comment on `otherDays` below — and it
 * is passed to NextWeekSummary/actuals lookups exactly as before.
 *
 * When `nextWeek` is supplied (docs/plans/2026-07-29-next-week-preview.md,
 * Task 4 of that slice), its days render exactly as they did before this
 * task: collapsed to one summary row behind a closed `<details>`
 * (`NextWeekSummary`), each still marked "provisional" with a `~` before
 * its durations once expanded, except where the athlete pinned that date's
 * availability with an override, which makes it a real fact rather than a
 * projection. This task does not touch any of that — only the current
 * week's seven rows collapse to one.
 *
 * NOTE: `WeekRationale`, adherence and the weekly review stay Monday–Sunday
 * accounting for the week that's closing; this component is schedule, not
 * accounting.
 */
export function WeekDayList({
  days,
  today,
  openDate,
  nextWeek,
  actuals,
  structured,
}: {
  days: DaySlot[];
  today: string;
  /**
   * The one day of `days` to render, expanded — always a real date in
   * `days` by construction (openDayFrom, src/lib/week-plan/day-shape.ts,
   * never returns anything else). Required: WeekDayList renders nothing
   * from the current week without it.
   */
  openDate: string;
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
  /**
   * The open day's structured workouts, by session index. Resolved on the
   * server so the thirty-workout library never reaches the client bundle,
   * and passed only for the OPEN day: a collapsed row shows a type, a
   * duration and a band, and adding a profile to seven of them would bury
   * the one the athlete opened.
   */
  structured?: (DayWorkout | null)[];
}) {
  const openDay = days.find((d) => d.date === openDate);

  // Ymd strings compare lexicographically the same as chronologically —
  // the convention already used for this in replan.ts and service.ts.
  //
  // Built from days >= today, not the raw `days` prop: a past day must
  // never surface as a move/swap target in the open day's DayActions either
  // — DayActions itself only filters by workoutCount/isRace, trusting the
  // caller for "target days are always inside the open week" (its own
  // comment), so a rest day before today would otherwise leak back in
  // through the Target day dropdown even though its own row is never shown.
  const otherDays: DayActionsOtherDay[] = days
    .filter((d) => d.date >= today)
    .map((o) => ({
      date: o.date,
      workoutCount: o.workouts.length,
      isRace: o.status === "race",
    }));

  const nextWeekHasAvailability =
    nextWeek != null &&
    nextWeek.days.some((d) => d.workouts.length > 0 || d.availableMins > 0);

  return (
    <section className="glass mb-5 overflow-hidden rounded-[18px]">
      {openDay && (
        <DayRow
          key={openDay.date}
          day={openDay}
          isOpen
          structured={structured}
          badge={null}
          otherDays={otherDays}
          actual={actuals?.[openDay.date]}
          // I4: no action here can succeed on a day already completed or
          // missed, or on any day already in the past (see DayRow's
          // `actionable` doc comment) — those get the row, but not the
          // actions under it.
          actionable={
            openDay.date >= today &&
            openDay.status !== "completed" &&
            openDay.status !== "missed"
          }
        />
      )}

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
                isOpen={false}
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
