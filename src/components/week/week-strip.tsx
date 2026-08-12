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
  race: "bg-chart-4",
};

const DAY_LABELS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

function localYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function WeekStrip({ days }: Props) {
  if (!days || days.length === 0) return null;
  const today = localYmd(new Date());
  return (
    <div className="flex items-center justify-between rounded-[2rem] border border-hairline bg-surface-raised px-7 py-4">
      {days.map((d, i) => (
        <div key={d.date} className="flex flex-col items-center gap-2">
          <span className="text-label font-bold uppercase tracking-wider text-ink-muted">
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
