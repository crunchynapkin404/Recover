import type { DaySlot, DayStatus } from "@/lib/week-plan/types";

interface Props {
  days: DaySlot[] | null;
}

// Repo avoids blue for accents: chart-2 = done, chart-3 = changed,
// chart-5 = missed, muted ink = rest/planned. v0.99 slice 1 moved these
// onto theme tokens; the dark-mode hues are unchanged.
const STATUS_DOT: Record<DayStatus, string> = {
  completed: "bg-chart-2",
  adapted: "bg-chart-3",
  moved: "bg-chart-3",
  missed: "bg-chart-5",
  planned: "bg-ink-muted",
  rest: "bg-hairline opacity-40",
  // Unreachable today — the race branch below renders a 🏁 emoji and never
  // consults this map — but kept in sync with week-day-list.tsx's
  // bg-ink-race so a stale bg-chart-4 here can't paint the wrong colour if
  // that branch ever changes to fall back on the dot.
  race: "bg-ink-race",
};

const DAY_LABELS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

function localYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function WeekStrip({ days }: Props) {
  if (!days || days.length === 0) return null;
  const today = localYmd(new Date());
  return (
    // gap-x-2 is load-bearing since the 12px floor: at 10px the day labels
    // cleared each other under justify-between alone, at 12px they collide
    // into "MOTUWETHFRSASU" whenever the strip is squeezed (Today's desktop
    // week row puts it in a flex-1 beside the volume summary).
    <div className="flex items-center justify-between gap-x-2 rounded-[2rem] border border-hairline bg-surface-raised px-5 py-4">
      {days.map((d, i) => (
        <div key={d.date} className="flex flex-col items-center gap-2">
          <span className="text-label font-bold uppercase text-ink-muted">
            {DAY_LABELS[i] ?? ""}
          </span>
          {d.status === "race" ? (
            <span
              data-status="race"
              title={d.raceName ?? "Race day"}
              aria-label={d.raceName ? `Race day: ${d.raceName}` : "Race day"}
              className={`flex h-3 w-3 items-center justify-center text-label leading-none ${
                d.date === today ? "rounded-full ring-2 ring-ink-muted" : ""
              }`}
            >
              🏁
            </span>
          ) : (
            <span
              data-status={d.status}
              className={`h-2.5 w-2.5 rounded-full ${STATUS_DOT[d.status]} ${
                d.date === today ? "ring-2 ring-ink-muted" : ""
              }`}
            />
          )}
        </div>
      ))}
    </div>
  );
}
