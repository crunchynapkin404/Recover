import type { DaySlot } from "@/lib/week-plan/types";
import { sessionToZwo } from "./zwo";

export type WeekExportRefusal = {
  date: string;
  index: number;
  reason: string;
  message: string;
};

export function exportWeekToZwo(days: DaySlot[]) {
  const ordered = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const exports: Array<{ fileName: string; content: string }> = [];
  const refusals: WeekExportRefusal[] = [];

  for (const day of ordered) {
    day.workouts.forEach((workout, index) => {
      const id = `${day.date}-${String(index + 1).padStart(2, "0")}-${workout.type}`;
      const out = sessionToZwo(workout, { id });
      if (out.ok) {
        exports.push({ fileName: out.fileName, content: out.content });
      } else {
        refusals.push({
          date: day.date,
          index,
          reason: out.reason,
          message: out.message,
        });
      }
    });
  }

  return { exports, refusals };
}
