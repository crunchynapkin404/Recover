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

function localYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * The week as one grouped surface with hairline rows (1c) — replacing the
 * seven separate glass cards. Today's row is highlighted and is the only
 * one that carries its move/swap/skip actions inline; the rest stay a
 * scannable list.
 *
 * NOTE: the v0.21 /plan page put DayActions on every day that had a
 * workout, so a future day could be rescheduled directly from its own row.
 * The 1c mockup shows the action pills only under today. Dropping the
 * `isToday &&` guard below restores the old reach if that turns out to
 * matter more than the quieter list.
 */
export function WeekDayList({ days }: { days: DaySlot[] }) {
  const today = localYmd(new Date());
  const otherDays: DayActionsOtherDay[] = days.map((o) => ({
    date: o.date,
    hasWorkout: o.workout !== null,
    isRace: o.status === "race",
  }));

  return (
    <section className="mb-5 overflow-hidden rounded-[18px] border border-white/[0.08] bg-white/[0.03]">
      {days.map((d) => {
        const isToday = d.date === today;
        return (
          <div
            key={d.date}
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
                {d.workout ? (
                  <p
                    className={`truncate text-[12.5px] ${isToday ? "font-bold text-white" : "text-white/85"}`}
                  >
                    {`${d.workout.type} · ${d.workout.durationMins} min`}
                    <span className="ml-1.5 font-normal text-white/40">
                      {d.workout.intensity}
                    </span>
                  </p>
                ) : d.status === "race" ? (
                  <p className="truncate text-[12.5px] font-bold text-fuchsia-300">
                    <span aria-hidden>🏁 </span>
                    {d.raceName ?? "Race day"}
                  </p>
                ) : (
                  <p className="text-[12.5px] text-white/50">
                    Rest
                    <span className="ml-1.5 text-white/30">
                      {`${d.availableMins} min free`}
                    </span>
                  </p>
                )}
                {d.movedFrom && (
                  <p className="mt-0.5 text-[10.5px] text-amber-400/80">
                    {`moved from ${weekdayOf(d.movedFrom)}`}
                  </p>
                )}
              </div>

              <span
                className={`shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${STATUS_CHIP[d.status]}`}
              >
                {d.status}
              </span>
            </div>

            {isToday && d.workout && (
              <DayActions
                day={{ date: d.date, hasWorkout: true }}
                otherDays={otherDays.filter((o) => o.date !== d.date)}
              />
            )}
          </div>
        );
      })}
    </section>
  );
}
