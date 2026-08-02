/**
 * v0.36 wellness history backfill.
 *
 * Two independent losses, both invisible to the daily sync:
 *
 * Phase A — every wellness row stores the provider's full payload in `raw`,
 * but the columns were written by whatever mapping existed at sync time. v0.33
 * added mappings for steps, spO2, vo2max, sleepQuality, sleeping HR, body fat
 * and hydration, and only the 7-day incremental overlap ever flowed through
 * them. The data is already local; it just needs re-mapping.
 *
 * Phase B — the first sync was capped at 365 days and every sync since has
 * re-fetched a 7-day overlap, so everything before that cap was never fetched.
 *
 * Both phases write through `applyWellnessPatch`, so a backfilled day is
 * indistinguishable from a synced one and can never outrank a better source.
 */
import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { logger } from "@/lib/logger";
import {
  fetchDailyWellness,
  normalizeWellnessRow,
} from "@/lib/connectors/intervals";
import { wellnessDayToPatch } from "@/lib/sync/intervals-sync";
import { applyWellnessPatch } from "@/lib/wellness-merge";
import type { WellnessFetcher } from "@/lib/sync/wellness-refresh";

/**
 * Phase A: re-map payloads already stored in `wellness_daily.raw`.
 *
 * No network calls. Returns how many rows actually changed and the oldest
 * changed date, which the caller feeds to `computeDailyMetrics`.
 */
export async function remapStoredWellness(
  userId: string
): Promise<{ remapped: number; earliestDate: string | null }> {
  const rows = await db.query.wellnessDaily.findMany({
    where: eq(schema.wellnessDaily.userId, userId),
    columns: { date: true, raw: true },
    orderBy: asc(schema.wellnessDaily.date),
  });

  let remapped = 0;
  let earliestDate: string | null = null;

  for (const row of rows) {
    const raw = row.raw as Record<string, unknown> | null;
    // intervals.icu wellness rows carry the date as `id`. That equality is the
    // discriminator: another provider may have written this row's `raw` last,
    // and parsing an Apple Health payload through the intervals mapping would
    // read fields that mean something else.
    if (!raw || raw.id !== row.date) continue;

    const day = normalizeWellnessRow(raw);
    if (!day) continue;

    const changed = await applyWellnessPatch(
      userId,
      row.date,
      wellnessDayToPatch(day),
      "intervals_icu",
      raw
    );
    if (changed) {
      remapped++;
      earliestDate ??= row.date;
    }
  }

  return { remapped, earliestDate };
}

/** Safety stop. No athlete has 20 years of intervals.icu history, and an
 *  endless walk against a free service is worse than a truncated backfill. */
export const MAX_BACKFILL_YEARS = 20;

/** Pause between year chunks. intervals.icu is free and run by one developer;
 *  a backfill is the one place this app makes a burst of requests. */
const DEFAULT_CHUNK_DELAY_MS = 1000;

export interface BackfillResult {
  /** Rows whose columns changed from their own stored raw payload. */
  remapped: number;
  /** Days written from newly fetched history. */
  fetched: number;
  /** Oldest date either phase touched — the metrics recompute floor. */
  earliestDate: string | null;
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** The day before `date`, as YYYY-MM-DD. */
function dayBefore(date: string): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return ymd(d);
}

async function pause(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Recover every wellness day and every mappable field intervals.icu holds.
 *
 * Deliberately does NOT touch `connections.lastSyncAt` — that cursor decides
 * the incremental sync's window, and moving it here would silently widen or
 * skip the daily sync.
 *
 * `fetcher` is the test seam. `onProgress` is the heartbeat the scheduler uses
 * to keep this job from being reclaimed as stale mid-run.
 */
export async function runIntervalsBackfill(
  userId: string,
  opts?: {
    fetcher?: WellnessFetcher;
    onProgress?: () => Promise<void>;
    delayMs?: number;
  }
): Promise<BackfillResult> {
  const connection = await db.query.connections.findFirst({
    where: and(
      eq(schema.connections.userId, userId),
      eq(schema.connections.provider, "intervals_icu")
    ),
  });
  if (!connection) {
    throw new Error("No intervals.icu connection for this user.");
  }

  const fetcher = opts?.fetcher ?? fetchDailyWellness;
  const delayMs = opts?.delayMs ?? DEFAULT_CHUNK_DELAY_MS;
  const heartbeat = opts?.onProgress ?? (async () => {});

  // Phase A — no network.
  const { remapped, earliestDate: remappedFrom } =
    await remapStoredWellness(userId);
  await heartbeat();

  // Phase B — walk back from the day before the oldest row we hold.
  const oldest = await db.query.wellnessDaily.findFirst({
    where: eq(schema.wellnessDaily.userId, userId),
    columns: { date: true },
    orderBy: asc(schema.wellnessDaily.date),
  });
  const boundary = oldest ? dayBefore(oldest.date) : ymd(new Date());

  const apiKey = decrypt(connection.encryptedAccessToken);
  const athleteId = connection.externalAthleteId;

  let fetched = 0;
  let fetchedFrom: string | null = null;
  let year = Number(boundary.slice(0, 4));

  for (let chunk = 0; chunk < MAX_BACKFILL_YEARS; chunk++) {
    const startYmd = `${year}-01-01`;
    // The first chunk stops at the boundary; every later one is a whole year.
    const endYmd = chunk === 0 ? boundary : `${year}-12-31`;
    if (endYmd < startYmd) break;

    const days = await fetcher({
      apiKey,
      athleteId,
      startDate: new Date(`${startYmd}T00:00:00.000Z`),
      endDate: new Date(`${endYmd}T00:00:00.000Z`),
    });
    if (days.length === 0) break;

    for (const d of days) {
      if (!d.date) continue;
      await applyWellnessPatch(
        userId,
        d.date,
        wellnessDayToPatch(d),
        "intervals_icu",
        d.raw
      );
      fetched++;
      if (fetchedFrom == null || d.date < fetchedFrom) fetchedFrom = d.date;
    }

    await heartbeat();
    year--;
    await pause(delayMs);
  }

  const earliestDate =
    [remappedFrom, fetchedFrom]
      .filter((d): d is string => d != null)
      .sort()[0] ?? null;

  // One recompute over everything both phases touched, not one per phase.
  // This rewrites daily_metrics from `earliestDate` forward and re-derives the
  // trailing baselines readiness is scored against, so today's score moves.
  if (earliestDate) {
    const { computeDailyMetrics } = await import("@/lib/metrics");
    await computeDailyMetrics(userId, earliestDate);
  }

  logger.info("intervals backfill complete", {
    userId,
    remapped,
    fetched,
    earliestDate,
  });

  return { remapped, fetched, earliestDate };
}
