// src/lib/week-plan/availability.ts
import { BUSY_DAY_MINS } from "./types";

export interface PrefillInput {
  hoursPerWeek: number;
  daysPerWeek: number;
  lastWeekMins: number[] | null;
  busyMinsPerDay: number[] | null;
}

function roundTo5(n: number): number {
  return Math.max(0, Math.round(n / 5) * 5);
}

export function prefillAvailability(input: PrefillInput): number[] {
  let base: number[];
  if (input.lastWeekMins && input.lastWeekMins.length === 7) {
    base = [...input.lastWeekMins];
  } else {
    const perDay = (input.hoursPerWeek * 60) / Math.max(1, input.daysPerWeek);
    base = Array.from({ length: 7 }, (_, i) =>
      i >= 7 - input.daysPerWeek ? perDay : 0
    );
  }
  return base.map((mins, i) => {
    const busy = input.busyMinsPerDay?.[i] ?? 0;
    return roundTo5(busy >= BUSY_DAY_MINS ? mins / 2 : mins);
  });
}
