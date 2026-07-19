import type { DaySlot, DayStatus } from "@/lib/week-plan/types";

interface Props {
  days: DaySlot[] | null;
}

// Repo avoids blue for accents: emerald = done, amber = changed,
// red = missed, faint white = rest/planned.
const STATUS_DOT: Record<DayStatus, string> = {
  completed: "bg-emerald-400",
  adapted: "bg-amber-400",
  moved: "bg-amber-400",
  missed: "bg-red-400",
  planned: "bg-white/40",
  rest: "bg-white/15",
  race: "bg-fuchsia-400",
};

const DAY_LABELS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

function localYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function WeekStrip({ days }: Props) {
  if (!days || days.length === 0) return null;
  const today = localYmd(new Date());
  return (
    <div className="glass flex items-center justify-between rounded-[2rem] px-7 py-4">
      {days.map((d, i) => (
        <div key={d.date} className="flex flex-col items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-white/40">
            {DAY_LABELS[i] ?? ""}
          </span>
          <span
            data-status={d.status}
            className={`h-2.5 w-2.5 rounded-full ${STATUS_DOT[d.status]} ${
              d.date === today ? "ring-2 ring-white/50" : ""
            }`}
          />
        </div>
      ))}
    </div>
  );
}
