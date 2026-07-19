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
    const scenario: ScenarioEnd = { tsb, band: formOutlook(tsb) };
    return {
      insufficient: false,
      days,
      endDate,
      capped,
      full: scenario,
      // Zero remaining days: adherence scaling is moot, so the adherence
      // scenario legitimately coincides with full — but it's still null
      // when the caller supplied no adherenceFraction at all.
      adherence: inputs.adherenceFraction != null ? scenario : null,
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

export type PlanChange =
  | { kind: "move"; fromDate: string; toDate: string }
  | { kind: "swap"; fromDate: string; toDate: string }
  | { kind: "skip"; fromDate: string };

export interface SimulationResult {
  before: ForecastResult;
  after: ForecastResult;
  /** after.full.tsb − before.full.tsb; null when either side is insufficient. */
  deltaTsb: number | null;
  /** Total planned-load change (skip is negative; move/swap are 0). */
  loadDelta: number;
}

function applyChange(
  planned: { date: string; load: number }[],
  change: PlanChange
): { date: string; load: number }[] {
  const map = new Map(planned.map((p) => [p.date, p.load]));
  const from = map.get(change.fromDate) ?? 0;
  if (change.kind === "skip") {
    map.set(change.fromDate, 0);
  } else if (change.kind === "move") {
    map.set(change.fromDate, 0);
    map.set(change.toDate, (map.get(change.toDate) ?? 0) + from);
  } else {
    const to = map.get(change.toDate) ?? 0;
    map.set(change.fromDate, to);
    map.set(change.toDate, from);
  }
  return [...map.entries()].map(([date, load]) => ({ date, load }));
}

export function simulatePlanChange(
  inputs: ForecastInputs,
  change: PlanChange
): SimulationResult {
  const before = forecastForm(inputs);
  const changedLoads = applyChange(inputs.plannedLoads, change);
  const after = forecastForm({ ...inputs, plannedLoads: changedLoads });
  const sum = (xs: { load: number }[]) => xs.reduce((s, x) => s + x.load, 0);
  return {
    before,
    after,
    deltaTsb:
      before.insufficient || after.insufficient
        ? null
        : round1(after.full.tsb - before.full.tsb),
    loadDelta: sum(changedLoads) - sum(inputs.plannedLoads),
  };
}
