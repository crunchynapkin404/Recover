import type { DaySlot } from "@/lib/week-plan/types";
import {
  DayActions,
  type DayActionsOtherDay,
} from "@/components/plan/day-actions";

// Same status palette the week strip and the v0.19 plan rows already use.
const STATUS_CHIP: Record<DaySlot["status"], string> = {
  completed: "border-emerald-400/30 text-emerald-400",
  adapted: "border-amber-400/30 text-amber-400",
  moved: "border-amber-400/30 text-amber-400",
  missed: "border-red-400/30 text-red-400",
  planned: "border-white/15 text-white/60",
  rest: "border-white/10 text-white/35",
  race: "border-fuchsia-400/30 text-fuchsia-300",
};

const WEEKDAY = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function weekdayOf(ymd: string): string {
  // Monday-first index; the slot dates are already local Ymd strings.
  return WEEKDAY[(new Date(ymd + "T00:00:00").getDay() + 6) % 7];
}

/**
 * A next-week row is provisional (forecast, not yet materialized) unless the
 * athlete pinned that date's availability with an override — a pin means
 * the day's availableBlocks are real, athlete-set facts, not a projection.
 */
type RowBadge = "provisional" | "pinned" | null;

interface DayRowProps {
  day: DaySlot;
  isToday: boolean;
  badge: RowBadge;
  otherDays: DayActionsOtherDay[];
}

function DayRow({ day: d, isToday, badge, otherDays }: DayRowProps) {
  const provisional = badge === "provisional";
  return (
    <div
      data-date={d.date}
      data-today={isToday ? "" : undefined}
      className={`border-b border-white/[0.06] px-4 py-3 last:border-0 ${
        isToday ? "bg-white/[0.03]" : ""
      }`}
    >
      <div className="flex items-center gap-3">
        <span
          className={`w-[34px] shrink-0 text-[9px] font-bold uppercase tracking-[0.15em] ${
            isToday ? "text-white/80" : "text-white/40"
          }`}
        >
          {weekdayOf(d.date)}
        </span>

        <div className="min-w-0 flex-1">
          {d.workouts.length > 0 ? (
            d.workouts.map((w, i) => (
              <p
                key={i}
                className={`truncate text-[12.5px] ${isToday ? "font-bold text-white" : "text-white/85"}`}
              >
                {`${w.type} · ${provisional ? "~" : ""}${w.durationMins} min`}
                <span className="ml-1.5 font-normal text-white/40">
                  {w.intensity}
                </span>
              </p>
            ))
          ) : d.status === "race" ? (
            <p className="truncate text-[12.5px] font-bold text-fuchsia-300">
              <span aria-hidden>🏁 </span>
              {d.raceName ?? "Race day"}
            </p>
          ) : (
            <p className="text-[12.5px] text-white/50">
              Rest
              <span className="ml-1.5 text-white/30">
                {`${provisional ? "~" : ""}${d.availableMins} min free`}
              </span>
            </p>
          )}
          {d.movedFrom && (
            <p className="mt-0.5 text-[10.5px] text-amber-400/80">
              {`moved from ${weekdayOf(d.movedFrom)}`}
            </p>
          )}
        </div>

        {badge && (
          <span className="shrink-0 rounded-full border border-white/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white/40">
            {badge}
          </span>
        )}

        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${STATUS_CHIP[d.status]}`}
        >
          {d.status}
        </span>
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
 * 4), its days render after a visible boundary row, each marked
 * "provisional" with a `~` before its durations — a forecast, not yet
 * materialized — except where the athlete pinned that date's availability
 * with an override, which makes it a real fact rather than a projection.
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
}: {
  days: DaySlot[];
  today: string;
  nextWeek?: { days: DaySlot[]; pinned: Record<string, boolean> } | null;
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
    <section className="mb-5 overflow-hidden rounded-[18px] border border-white/[0.08] bg-white/[0.03]">
      {visibleDays.map((d) => (
        <DayRow
          key={d.date}
          day={d}
          isToday={d.date === today}
          badge={null}
          otherDays={otherDays}
        />
      ))}

      {nextWeek && (
        <div className="border-b border-white/[0.06] bg-white/[0.02] px-4 py-2 text-center text-[9px] font-bold uppercase tracking-[0.2em] text-white/35 last:border-0">
          next week
        </div>
      )}

      {nextWeek &&
        (nextWeekHasAvailability ? (
          nextWeek.days.map((d) => (
            <DayRow
              key={d.date}
              day={d}
              isToday={false}
              badge={nextWeek.pinned[d.date] ? "pinned" : "provisional"}
              otherDays={otherDays}
            />
          ))
        ) : (
          <div className="px-4 py-3 text-[12.5px] text-white/40 last:border-0">
            No availability set for next week
          </div>
        ))}
    </section>
  );
}
