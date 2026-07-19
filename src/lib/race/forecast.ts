// src/lib/race/forecast.ts — pure race-day form projection. Forecasts the
// FORM component only (TSB): HRV and RHR cannot be forecast, and calling
// this a projected readiness score would be fabrication (spec, Principle).
// Reuses the exact EMA recurrence of the honest load engine.
import { ATL_DAYS, CTL_DAYS } from "@/lib/training-load";

export type FormBand = "green" | "amber" | "red";

export const ADHERENCE_FLOOR = 0.5;
export const ADHERENCE_CEIL = 1.5;

export interface ForecastInputs {
  today: string;
  targetDate: string;
  start: { ctl: number; atl: number } | null;
  plannedLoads: { date: string; load: number }[];
  adherenceFraction: number | null;
  horizonEnd: string;
}

export interface ForecastDay {
  date: string;
  ctl: number;
  atl: number;
  tsb: number;
}

export interface ScenarioEnd {
  tsb: number;
  band: FormBand;
}

export type ForecastResult =
  | { insufficient: true }
  | {
      insufficient: false;
      days: ForecastDay[];
      endDate: string;
      capped: boolean;
      full: ScenarioEnd;
      adherence: ScenarioEnd | null;
    };

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function addDays(ymd: string, n: number): string {
  const d = new Date(ymd + "T00:00:00");
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** TSB → the readiness engine's form component → its band thresholds. */
export function formOutlook(tsb: number): FormBand {
  const score = Math.min(90, Math.max(10, 50 + 2.5 * tsb));
  return score >= 67 ? "green" : score >= 34 ? "amber" : "red";
}

function walk(
  start: { ctl: number; atl: number },
  loads: Map<string, number>,
  from: string,
  to: string,
  scale: number
): ForecastDay[] {
  const days: ForecastDay[] = [];
  let ctl = start.ctl;
  let atl = start.atl;
  for (let day = addDays(from, 1); day <= to; day = addDays(day, 1)) {
    const load = (loads.get(day) ?? 0) * scale;
    ctl = ctl + (load - ctl) / CTL_DAYS;
    atl = atl + (load - atl) / ATL_DAYS;
    days.push({
      date: day,
      ctl: round1(ctl),
      atl: round1(atl),
      tsb: round1(ctl - atl),
    });
  }
  return days;
}

export function forecastForm(inputs: ForecastInputs): ForecastResult {
  if (inputs.start == null) return { insufficient: true };
  const endDate =
    inputs.horizonEnd < inputs.targetDate
      ? inputs.horizonEnd
      : inputs.targetDate;
  const capped = inputs.horizonEnd < inputs.targetDate;
  const loads = new Map(inputs.plannedLoads.map((p) => [p.date, p.load]));

  const days = walk(inputs.start, loads, inputs.today, endDate, 1);
  if (days.length === 0) {
    const tsb = round1(inputs.start.ctl - inputs.start.atl);
    return {
      insufficient: false,
      days,
      endDate,
      capped,
      full: { tsb, band: formOutlook(tsb) },
      adherence: null,
    };
  }
  const last = days[days.length - 1];

  let adherence: ScenarioEnd | null = null;
  if (inputs.adherenceFraction != null) {
    const f = Math.min(
      ADHERENCE_CEIL,
      Math.max(ADHERENCE_FLOOR, inputs.adherenceFraction)
    );
    const aDays = walk(inputs.start, loads, inputs.today, endDate, f);
    const aLast = aDays[aDays.length - 1];
    adherence = { tsb: aLast.tsb, band: formOutlook(aLast.tsb) };
  }

  return {
    insufficient: false,
    days,
    endDate,
    capped,
    full: { tsb: last.tsb, band: formOutlook(last.tsb) },
    adherence,
  };
}
