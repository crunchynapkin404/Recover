import type { DaySlot } from "@/lib/week-plan/types";
import { STATUS_DOT } from "@/lib/status-color";
import { WEEKDAY_NARROW } from "@/lib/weekdays";

interface Props {
  days: DaySlot[] | null;
}

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
            {WEEKDAY_NARROW[i] ?? ""}
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
