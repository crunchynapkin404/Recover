/**
 * v0.6 Strava AI Descriptions — deterministic metric template built from
 * intervals.icu data ONLY (activities.raw, wellness_daily, athlete_curves)
 * and pushed to Strava. Write-only toward Strava: the existing Strava
 * description is read solely for append/skip mechanics and must never be
 * returned into AI context (Strava API AI clause).
 */

import type { IntervalsBestEffort } from "@/lib/connectors/intervals";

export const MARKER = "\n📊 Recover";

/** Append-or-skip merge (spec verbatim). */
export function buildDescription(
  existing: string | null,
  generated: string
): string {
  if (!existing) return generated + MARKER;
  if (existing.includes(MARKER)) return existing; // already described
  return existing + "\n\n---\n" + generated + MARKER;
}

export interface DescriptionInput {
  title: string | null;
  sport: string;
  load: number | null;
  intensityPct: number | null;
  trimp: number | null;
  powerHrRatio: number | null;
  decouplingPct: number | null;
  carbsPerHour: number | null;
  /** Runs only; computed from intervals.icu distance/duration. */
  paceSecPerKm: number | null;
  ctl: number | null;
  tsb: number | null;
  ftpW: number | null;
  vo2max: number | null;
  /** Pre-formatted, e.g. "594W/1m — all-time PR". Max 3 rendered. */
  prLines: string[];
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function sportEmoji(sport: string): string {
  const s = sport.toLowerCase();
  if (s.includes("ride") || s.includes("bike") || s.includes("cycl")) {
    return "🚴";
  }
  if (s.includes("run")) return "🏃";
  if (s.includes("swim")) return "🏊";
  return "🏔️";
}

function isRunSport(sport: string): boolean {
  return sport.toLowerCase().includes("run");
}

/** intervals.icu icu_intensity arrives as fraction (0.87) or percent (87). */
export function normalizeIntensityPct(v: number | null): number | null {
  if (v == null) return null;
  return v <= 2 ? Math.round(v * 100) : Math.round(v);
}

/** Seconds-per-km → "m:ss". */
export function formatPace(secPerKm: number): string {
  const total = Math.round(secPerKm);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Join non-null segments with " | "; null when nothing survives. */
function joinSegments(segments: Array<string | null>): string | null {
  const present = segments.filter((s): s is string => s != null);
  return present.length > 0 ? present.join(" | ") : null;
}

/** Render the emoji template. Null fields/lines are omitted (no "N/A"). */
export function formatActivityDescription(input: DescriptionInput): string {
  const lines: string[] = [];
  lines.push(`${sportEmoji(input.sport)} ${input.title ?? input.sport}`);

  const load = joinSegments([
    input.load != null ? `TL ${Math.round(input.load)}` : null,
    input.intensityPct != null ? `IF ${input.intensityPct}%` : null,
    input.trimp != null ? `TRIMP ${Math.round(input.trimp)}` : null,
  ]);
  if (load) lines.push(`🔋 Load: ${load}`);

  const decoupling =
    input.decouplingPct != null
      ? `decoupling ${input.decouplingPct.toFixed(1)}%`
      : null;
  if (isRunSport(input.sport)) {
    // Runs show pace metrics instead of power (spec).
    const pace = joinSegments([
      input.paceSecPerKm != null
        ? `${formatPace(input.paceSecPerKm)}/km`
        : null,
      decoupling,
    ]);
    if (pace) lines.push(`⚡ Pace: ${pace}`);
  } else {
    const efficiency = joinSegments([
      input.powerHrRatio != null
        ? `Pw:Hr ${input.powerHrRatio.toFixed(2)}`
        : null,
      decoupling,
    ]);
    if (efficiency) lines.push(`⚡ Efficiency: ${efficiency}`);
  }

  if (input.carbsPerHour != null) {
    lines.push(`🍔 Carbs: ~${Math.round(input.carbsPerHour)} g/u`);
  }

  const form = joinSegments([
    input.ctl != null ? `CTL ${Math.round(input.ctl)}` : null,
    input.tsb != null ? `TSB ${Math.round(input.tsb)}` : null,
    input.ftpW != null ? `eFTP ${Math.round(input.ftpW)} W` : null,
    input.vo2max != null ? `VO2 ${input.vo2max.toFixed(1)}` : null,
  ]);
  if (form) lines.push(`📈 Form: ${form}`);

  for (const pr of input.prLines.slice(0, 3)) lines.push(`🚀 ${pr}`);

  return lines.join("\n");
}

/** Pull the spec's metric fields out of an intervals.icu raw activity. */
export function metricsFromRaw(raw: Record<string, unknown>): {
  load: number | null;
  intensityPct: number | null;
  trimp: number | null;
  powerHrRatio: number | null;
  decouplingPct: number | null;
  carbsPerHour: number | null;
  ftpW: number | null;
  vo2max: number | null;
} {
  return {
    load: num(raw.icu_training_load),
    intensityPct: normalizeIntensityPct(num(raw.icu_intensity)),
    trimp: num(raw.trimp),
    powerHrRatio: num(raw.power_hr_ratio) ?? num(raw.icu_power_hr),
    decouplingPct: num(raw.hr_decoupling) ?? num(raw.decoupling),
    carbsPerHour: num(raw.carbs_per_hour),
    ftpW: num(raw.icu_ftp) ?? num(raw.eftp),
    vo2max: num(raw.icu_vo2max_estimate) ?? num(raw.vo2max),
  };
}

/** Strava activity id linked by intervals.icu, if any (field name varies). */
export function stravaIdFromRaw(
  raw: Record<string, unknown> | null
): string | null {
  if (!raw) return null;
  const candidate = raw.strava_id ?? raw.strava_activity_id;
  if (typeof candidate === "number" && Number.isFinite(candidate)) {
    return String(candidate);
  }
  if (typeof candidate === "string") {
    const digits = candidate.match(/\d+$/);
    if (digits) return digits[0];
  }
  return null;
}

/**
 * PR lines for efforts set in this activity ("all-time" = 365d cache, the
 * widest window Recover ever backfills). Capped at 3.
 */
export function formatPrLines(
  efforts: IntervalsBestEffort[],
  activityExternalId: string
): string[] {
  return efforts
    .filter((e) => e.activityExternalId === activityExternalId)
    .slice(0, 3)
    .map((e) => `${Math.round(e.value)}${e.unit}/${e.label} — all-time PR`);
}
