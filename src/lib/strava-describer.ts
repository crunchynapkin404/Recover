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
import {
  isFieldEnabled,
  type DescriptionField,
  type DescriptionFields,
} from "@/lib/strava-description-fields";
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
  /** Athlete's own debrief answers — never inferred, only what they gave. */
  perceivedExertion: number | null;
  feel: "strong" | "normal" | "weak" | null;
  /** Short (~1 sentence) ride review summary, if one has been generated. */
  review: string | null;
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

/**
 * Render the emoji template. Null fields/lines are omitted (no "N/A").
 * `fields` (v0.6.2) gates each metric; null/undefined = every field on.
 */
export function formatActivityDescription(
  input: DescriptionInput,
  fields?: DescriptionFields
): string {
  const on = (key: DescriptionField) => isFieldEnabled(fields, key);
  const lines: string[] = [];

  if (on("header")) {
    lines.push(`${sportEmoji(input.sport)} ${input.title ?? input.sport}`);
  }

  const load = joinSegments([
    on("load") && input.load != null ? `TL ${Math.round(input.load)}` : null,
    on("intensity") && input.intensityPct != null
      ? `IF ${input.intensityPct}%`
      : null,
    on("trimp") && input.trimp != null
      ? `TRIMP ${Math.round(input.trimp)}`
      : null,
  ]);
  if (load) lines.push(`🔋 Load: ${load}`);

  const decoupling =
    on("decoupling") && input.decouplingPct != null
      ? `decoupling ${input.decouplingPct.toFixed(1)}%`
      : null;
  if (isRunSport(input.sport)) {
    // Runs show pace metrics instead of power (spec).
    const pace = joinSegments([
      on("pace") && input.paceSecPerKm != null
        ? `${formatPace(input.paceSecPerKm)}/km`
        : null,
      decoupling,
    ]);
    if (pace) lines.push(`⚡ Pace: ${pace}`);
  } else {
    const efficiency = joinSegments([
      on("powerHrRatio") && input.powerHrRatio != null
        ? `Pw:Hr ${input.powerHrRatio.toFixed(2)}`
        : null,
      decoupling,
    ]);
    if (efficiency) lines.push(`⚡ Efficiency: ${efficiency}`);
  }

  if (on("carbs") && input.carbsPerHour != null) {
    lines.push(`🍔 Carbs: ~${Math.round(input.carbsPerHour)} g/u`);
  }

  const form = joinSegments([
    on("ctl") && input.ctl != null ? `CTL ${Math.round(input.ctl)}` : null,
    on("tsb") && input.tsb != null ? `TSB ${Math.round(input.tsb)}` : null,
    on("eftp") && input.ftpW != null
      ? `eFTP ${Math.round(input.ftpW)} W`
      : null,
    on("vo2max") && input.vo2max != null
      ? `VO2 ${input.vo2max.toFixed(1)}`
      : null,
  ]);
  if (form) lines.push(`📈 Form: ${form}`);

  if (on("prs")) {
    for (const pr of input.prLines.slice(0, 3)) lines.push(`🚀 ${pr}`);
  }

  if (on("rpe")) {
    const rpe = joinSegments([
      input.perceivedExertion != null
        ? `RPE ${input.perceivedExertion}/10`
        : null,
      input.feel != null ? `felt ${input.feel}` : null,
    ]);
    if (rpe) lines.push(`💪 ${rpe}`);
  }

  if (on("review") && input.review) {
    lines.push(`📝 ${input.review}`);
  }

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
 * Resolve the Strava activity id to describe, including the one case
 * `stravaIdFromRaw` alone can't cover: an activity intervals.icu sourced
 * from Strava carries no `strava_id`/`strava_activity_id` field at all (its
 * API withholds that data — see the module comment) — but for those rows
 * intervals.icu's own `id` (== this row's `externalId`) already *is* the
 * Strava activity id, confirmed against the sibling native `provider:
 * "strava"` row's `externalId` for the same ride.
 */
export function resolveStravaId(activity: {
  raw: Record<string, unknown> | null;
  externalId: string;
}): string | null {
  const direct = stravaIdFromRaw(activity.raw);
  if (direct) return direct;
  return activity.raw?.source === "STRAVA" ? activity.externalId : null;
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
  activity: ActivityRow,
  fields: DescriptionFields
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

  return formatActivityDescription(
    {
      title: activity.name,
      sport: activity.sport,
      ...metrics,
      ftpW: metrics.ftpW ?? wellness?.eftp ?? null,
      vo2max: metrics.vo2max ?? wellness?.vo2max ?? null,
      paceSecPerKm,
      ctl,
      tsb,
      prLines,
      perceivedExertion: activity.perceivedExertion ?? null,
      feel: activity.feel ?? null,
      review: activity.reviewSummary ?? null,
    },
    fields
  );
}

export interface DescribeOutcome {
  wrote: boolean;
  /** The generated block only — safe for LLM context (never Strava text). */
  generated: string;
  reason?:
    | "no_data"
    | "no_strava_id"
    | "already_described"
    | "no_fields"
    | "awaiting_review";
}

/**
 * True while the activity's debrief popup is still outstanding (or its
 * review hasn't been generated yet). Describing early would permanently
 * lock out the review line — MARKER makes every write after the first a
 * no-op — so the caller must wait for reviewedAt instead of racing it.
 * debriefState == null usually means the activity was never eligible for a
 * debrief (pre-v0.15 rows, historical imports): describe those immediately.
 *
 * One narrow exception: a Strava-sourced intervals.icu stub's startDate can
 * be temporarily stuck in the future (intervals.icu only gives a bare local
 * wall-clock string for these, parsed as if it were already UTC — see the
 * timezone note in debrief/lifecycle.ts), which blocks debriefEligible's
 * age check until real time catches up. A still-null debriefState during
 * that window means "hasn't had its fair turn yet", not "never eligible" —
 * describing now would burn the one write this activity ever gets before
 * the athlete has a chance to answer. Once startDate is no longer in the
 * future, the lifecycle has had its shot either way and describing
 * proceeds as before.
 */
export function isAwaitingReview(
  activity: Pick<ActivityRow, "debriefState" | "reviewedAt" | "startDate" | "raw">
): boolean {
  if (activity.debriefState != null) return activity.reviewedAt == null;
  const raw = activity.raw as Record<string, unknown> | null;
  return raw?.source === "STRAVA" && activity.startDate.getTime() > Date.now();
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
  const stravaId = resolveStravaId({
    raw,
    externalId: params.activity.externalId,
  });
  if (!stravaId) return { wrote: false, generated: "", reason: "no_strava_id" };
  if (isAwaitingReview(params.activity)) {
    return { wrote: false, generated: "", reason: "awaiting_review" };
  }

  const prefs = await db.query.notificationPrefs.findFirst({
    where: eq(schema.notificationPrefs.userId, params.userId),
  });
  const generated = await buildGeneratedDescription(
    params.userId,
    params.activity,
    prefs?.stravaDescriptionFields ?? null
  );
  // Every field disabled → publishing would leave a bare marker that the
  // skip check then makes permanent. Write nothing, don't even read.
  if (generated === "") {
    return { wrote: false, generated: "", reason: "no_fields" };
  }

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

// ── Preview (settings UI) ────────────────────────────────────────────────────

/** Canned data for users with no synced activity yet. Plausible, not real. */
export const SAMPLE_PREVIEW_INPUT: DescriptionInput = {
  title: "Zone 2 endurance",
  sport: "Ride",
  load: 82,
  intensityPct: 87,
  trimp: 141,
  powerHrRatio: 1.83,
  decouplingPct: 4.2,
  carbsPerHour: 62,
  paceSecPerKm: null,
  ctl: 71,
  tsb: -8,
  ftpW: 288,
  vo2max: 54.1,
  prLines: ["594W/1m — all-time PR"],
  perceivedExertion: 6,
  feel: "strong",
  review: "Solid steady-state effort, right in zone despite the wind.",
};

/**
 * Render what a candidate field set would publish, against the athlete's most
 * recent real activity when one exists. The returned text is the generated
 * block only — the marker is appended at write time.
 */
export async function previewDescription(
  userId: string,
  fields: DescriptionFields
): Promise<{ text: string; sample: boolean }> {
  const recent = await db.query.activities.findMany({
    where: and(
      eq(schema.activities.userId, userId),
      eq(schema.activities.provider, "intervals_icu")
    ),
    orderBy: [desc(schema.activities.startDate)],
    limit: 20,
  });
  // Skip activities intervals.icu sourced from Strava — their raw payload
  // is a bare stub (no load/intensity/name/etc., see the module comment),
  // so previewing one would show an almost-empty description even though a
  // real recent ride would render fully.
  const target = recent.find(
    (a) =>
      a.raw != null &&
      (a.raw as Record<string, unknown>).source !== "STRAVA"
  );
  if (!target) {
    return {
      text: formatActivityDescription(SAMPLE_PREVIEW_INPUT, fields),
      sample: true,
    };
  }
  return {
    text: await buildGeneratedDescription(userId, target, fields),
    sample: false,
  };
}

export interface AutoDescribeResult {
  written: number;
  skipped: number;
  reason?: "disabled" | "no_connection" | "no_write_scope";
}

/**
 * Auth failures disable stravaWriteEnabled so we stop hammering Strava every
 * sync (settings re-shows the reconnect banner); any other error is just
 * logged and skipped. Returns true when the caller should stop further
 * attempts for this user (auth is dead until they reconnect).
 */
async function handleDescribeError(
  err: unknown,
  userId: string,
  connectionId: string,
  activityId: string
): Promise<boolean> {
  if (err instanceof StravaError && err.code === "auth") {
    await db
      .update(schema.connections)
      .set({ stravaWriteEnabled: false, lastError: err.message })
      .where(eq(schema.connections.id, connectionId));
    logger.warn("strava write disabled after auth failure", { userId });
    return true;
  }
  logger.error("auto-describe activity failed", {
    userId,
    activityId,
    message: err instanceof Error ? err.message : String(err),
  });
  return false;
}

/**
 * Describe a single activity right after its debrief resolves (review
 * posted, skipped, or expired) — called from generateRideReview/race debrief
 * so the Strava write lands within moments of the review being ready,
 * instead of waiting for the next daily sweep. No-ops quietly when the user
 * hasn't opted in, has no write-enabled connection, or the activity isn't an
 * intervals.icu one; describeActivityOnStrava's own awaiting_review guard
 * still applies, so this is safe to call speculatively.
 */
export async function describeActivityOnStravaForUser(
  userId: string,
  activityId: string
): Promise<void> {
  const prefs = await db.query.notificationPrefs.findFirst({
    where: eq(schema.notificationPrefs.userId, userId),
  });
  if (!prefs?.autoDescribeStrava) return;

  const connection = await db.query.connections.findFirst({
    where: and(
      eq(schema.connections.userId, userId),
      eq(schema.connections.provider, "strava"),
      eq(schema.connections.status, "active")
    ),
  });
  if (!connection || !connection.stravaWriteEnabled) return;

  const activity = await db.query.activities.findFirst({
    where: eq(schema.activities.id, activityId),
  });
  if (!activity || activity.provider !== "intervals_icu") return;

  try {
    const accessToken = await getValidStravaAccessToken(connection);
    await describeActivityOnStrava({ userId, activity, accessToken });
  } catch (err) {
    await handleDescribeError(err, userId, connection.id, activityId);
  }
}

/**
 * Post-sync hook: describe recent intervals.icu activities on Strava for
 * an opted-in user with a write-enabled Strava connection. Catch-up sweep —
 * describeActivityOnStravaForUser already covers the common case of "review
 * just resolved", so this mainly picks up activities that were still
 * awaiting_review, had write scope off, or errored earlier.
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
      const authFailed = await handleDescribeError(
        err,
        userId,
        connection.id,
        activity.id
      );
      skipped++;
      if (authFailed) break;
    }
  }

  if (written > 0) {
    logger.info("auto-describe complete", { userId, written, skipped });
  }
  return { written, skipped };
}
