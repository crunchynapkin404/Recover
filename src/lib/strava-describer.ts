/**
 * v0.6 Strava AI Descriptions — deterministic metric template built from
 * intervals.icu data ONLY (activities.raw, wellness_daily, athlete_curves)
 * and pushed to Strava. Write-only toward Strava: the existing Strava
 * description is read solely for append/skip mechanics and must never be
 * returned into AI context (Strava API AI clause).
 */

import { and, desc, eq, gte } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { logger } from "@/lib/logger";
import { getBestEffortsCached } from "@/lib/athlete-curves";
import type { IntervalsBestEffort } from "@/lib/connectors/intervals";
import {
  getStravaDescription,
  StravaError,
  updateStravaActivity,
} from "@/lib/connectors/strava";
import { getValidStravaAccessToken } from "@/lib/sync/strava-sync";

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

// ── Orchestration ────────────────────────────────────────────────────────────

type ActivityRow = typeof schema.activities.$inferSelect;

/** Only recent activities are candidates; bounds Strava API usage per sync. */
const DESCRIBE_WINDOW_DAYS = 7;
const MAX_PER_RUN = 10;

/** Assemble the generated block for one intervals.icu activity. */
async function buildGeneratedDescription(
  userId: string,
  activity: ActivityRow
): Promise<string> {
  const raw = (activity.raw ?? {}) as Record<string, unknown>;
  const metrics = metricsFromRaw(raw);

  const day = activity.startDate.toISOString().slice(0, 10);
  const wellness = await db.query.wellnessDaily.findFirst({
    where: and(
      eq(schema.wellnessDaily.userId, userId),
      eq(schema.wellnessDaily.date, day)
    ),
  });
  const ctl = wellness?.ctl ?? null;
  const tsb =
    wellness?.ctl != null && wellness?.atl != null
      ? wellness.ctl - wellness.atl
      : null;

  const best = await getBestEffortsCached(userId, { days: 365 });
  const prLines = best.available
    ? formatPrLines(best.data, activity.externalId)
    : [];

  const paceSecPerKm =
    isRunSport(activity.sport) &&
    activity.durationS != null &&
    activity.distanceM != null &&
    activity.distanceM > 0
      ? activity.durationS / (activity.distanceM / 1000)
      : null;

  return formatActivityDescription({
    title: activity.name,
    sport: activity.sport,
    ...metrics,
    ftpW: metrics.ftpW ?? wellness?.eftp ?? null,
    paceSecPerKm,
    ctl,
    tsb,
    prLines,
  });
}

export interface DescribeOutcome {
  wrote: boolean;
  /** The generated block only — safe for LLM context (never Strava text). */
  generated: string;
  reason?: "no_data" | "no_strava_id" | "already_described";
}

/**
 * Describe one activity on Strava. Reads the existing description only to
 * append/skip; throws StravaError on API failures.
 */
export async function describeActivityOnStrava(params: {
  userId: string;
  activity: ActivityRow;
  accessToken: string;
}): Promise<DescribeOutcome> {
  const raw = params.activity.raw as Record<string, unknown> | null;
  if (!raw) return { wrote: false, generated: "", reason: "no_data" };
  const stravaId = stravaIdFromRaw(raw);
  if (!stravaId) return { wrote: false, generated: "", reason: "no_strava_id" };

  const generated = await buildGeneratedDescription(
    params.userId,
    params.activity
  );
  const existing = await getStravaDescription(params.accessToken, stravaId);
  const merged = buildDescription(existing, generated);
  if (merged === existing) {
    return { wrote: false, generated, reason: "already_described" };
  }

  await updateStravaActivity({
    accessToken: params.accessToken,
    activityId: stravaId,
    description: merged,
  });
  return { wrote: true, generated };
}

export interface AutoDescribeResult {
  written: number;
  skipped: number;
  reason?: "disabled" | "no_connection" | "no_write_scope";
}

/**
 * Post-sync hook: describe recent intervals.icu activities on Strava for
 * an opted-in user with a write-enabled Strava connection.
 */
export async function runAutoDescribeStrava(
  userId: string
): Promise<AutoDescribeResult> {
  const prefs = await db.query.notificationPrefs.findFirst({
    where: eq(schema.notificationPrefs.userId, userId),
  });
  if (!prefs?.autoDescribeStrava) {
    return { written: 0, skipped: 0, reason: "disabled" };
  }

  const connection = await db.query.connections.findFirst({
    where: and(
      eq(schema.connections.userId, userId),
      eq(schema.connections.provider, "strava"),
      eq(schema.connections.status, "active")
    ),
  });
  if (!connection) return { written: 0, skipped: 0, reason: "no_connection" };
  if (!connection.stravaWriteEnabled) {
    return { written: 0, skipped: 0, reason: "no_write_scope" };
  }

  const since = new Date(
    Date.now() - DESCRIBE_WINDOW_DAYS * 24 * 60 * 60 * 1000
  );
  const recent = await db.query.activities.findMany({
    where: and(
      eq(schema.activities.userId, userId),
      eq(schema.activities.provider, "intervals_icu"),
      gte(schema.activities.startDate, since)
    ),
    orderBy: [desc(schema.activities.startDate)],
    limit: MAX_PER_RUN,
  });

  const accessToken = await getValidStravaAccessToken(connection);
  let written = 0;
  let skipped = 0;
  for (const activity of recent) {
    try {
      const outcome = await describeActivityOnStrava({
        userId,
        activity,
        accessToken,
      });
      if (outcome.wrote) written++;
      else skipped++;
    } catch (err) {
      if (err instanceof StravaError && err.code === "auth") {
        // Token lacks activity:write (or was revoked): disable and stop so
        // we don't hammer Strava every sync; settings re-shows the banner.
        await db
          .update(schema.connections)
          .set({ stravaWriteEnabled: false, lastError: err.message })
          .where(eq(schema.connections.id, connection.id));
        logger.warn("strava write disabled after auth failure", { userId });
        break;
      }
      skipped++;
      logger.error("auto-describe activity failed", {
        userId,
        activityId: activity.id,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (written > 0) {
    logger.info("auto-describe complete", { userId, written, skipped });
  }
  return { written, skipped };
}
