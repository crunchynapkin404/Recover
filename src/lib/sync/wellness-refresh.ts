/**
 * v0.33 morning wellness re-pull. The daily sync runs at SYNC_HOUR (05:00
 * local), but the Intervals.icu Companion iOS app writes HealthKit data into
 * the intervals.icu wellness log around 06:40 — so last night's sleep missed
 * the window by ~95 minutes and would not surface until the next morning.
 *
 * Guarded housekeeping pass on the scheduler tick, NOT a sync_jobs row (a
 * perpetually-pending poll job would suppress ensureJobsForConnections'
 * duplicate guard for the daily sync), exactly like activity-poll.ts.
 */
import { and, eq, inArray, isNull, lt, or } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { logger } from "@/lib/logger";
import { decrypt } from "@/lib/crypto";
import {
  fetchDailyWellness,
  type IntervalsWellnessDay,
} from "@/lib/connectors/intervals";
import { applyWellnessPatch } from "@/lib/wellness-merge";
import { wellnessDayToPatch } from "@/lib/sync/intervals-sync";

export const WELLNESS_REFRESH_INTERVAL_MIN = 30;
export const WELLNESS_REFRESH_START_HOUR = 5; // == scheduler SYNC_HOUR
export const WELLNESS_REFRESH_END_HOUR = 12;
/** Sleep is attributed to the bed date, so yesterday must be in range. */
export const WELLNESS_REFRESH_DAYS = 3;

export type WellnessFetcher = (params: {
  apiKey: string;
  athleteId: string;
  startDate: Date;
  endDate: Date;
}) => Promise<IntervalsWellnessDay[]>;

export function refreshWindowOpen(now: Date): boolean {
  const h = now.getHours();
  return h >= WELLNESS_REFRESH_START_HOUR && h < WELLNESS_REFRESH_END_HOUR;
}

function localYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Done for the day once yesterday carries both a duration and a stage —
 * the Companion has landed and there is nothing left to wait for.
 */
async function yesterdaySettled(userId: string, now: Date): Promise<boolean> {
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  const row = await db.query.wellnessDaily.findFirst({
    where: and(
      eq(schema.wellnessDaily.userId, userId),
      eq(schema.wellnessDaily.date, localYmd(y))
    ),
  });
  if (!row) return false;
  return (
    row.sleepSecs != null &&
    (row.sleepDeepSecs != null ||
      row.sleepRemSecs != null ||
      row.sleepLightSecs != null)
  );
}

/**
 * Re-pull recent wellness for every due intervals.icu connection.
 * Returns how many users were refreshed.
 *
 * `userIds`, when given, additionally restricts the DB-wide connections query
 * to that set — a TEST-ONLY safety valve. The production call site
 * (scheduler.ts) always calls with no options, so it never applies outside
 * tests. It exists because this pass pairs a DB-wide query with a caller-
 * injected data source (`fetcher`) whose return value is written verbatim into
 * whatever real rows match — the one combination that is actually dangerous on
 * a shared database. Omitting this scoping on the v0.15 activity poll let a
 * test write fabricated rows into the real owner's and a real invited user's
 * accounts before it was caught.
 */
export async function runWellnessRefresh(opts?: {
  now?: Date;
  fetcher?: WellnessFetcher;
  userIds?: string[];
}): Promise<number> {
  const now = opts?.now ?? new Date();
  if (!refreshWindowOpen(now)) return 0;
  const fetcher = opts?.fetcher ?? fetchDailyWellness;
  const dueBefore = new Date(
    now.getTime() - WELLNESS_REFRESH_INTERVAL_MIN * 60_000
  );

  const conns = await db.query.connections.findMany({
    where: and(
      eq(schema.connections.provider, "intervals_icu"),
      eq(schema.connections.status, "active"),
      or(
        isNull(schema.connections.lastWellnessPollAt),
        lt(schema.connections.lastWellnessPollAt, dueBefore)
      ),
      opts?.userIds
        ? inArray(schema.connections.userId, opts.userIds)
        : undefined
    ),
  });

  let refreshed = 0;
  for (const conn of conns) {
    if (await yesterdaySettled(conn.userId, now)) continue;

    // Stamp the cursor first, success or failure — a broken API key must not
    // tight-loop against intervals.icu every tick.
    await db
      .update(schema.connections)
      .set({ lastWellnessPollAt: now })
      .where(eq(schema.connections.id, conn.id));

    try {
      const startDate = new Date(now);
      startDate.setDate(startDate.getDate() - WELLNESS_REFRESH_DAYS);

      const days = await fetcher({
        apiKey: decrypt(conn.encryptedAccessToken),
        athleteId: conn.externalAthleteId,
        startDate,
        endDate: now,
      });

      let wrote = false;
      for (const day of days) {
        if (!day.date) continue;
        await applyWellnessPatch(
          conn.userId,
          day.date,
          wellnessDayToPatch(day),
          "intervals_icu",
          day.raw
        );
        wrote = true;
      }

      if (wrote) {
        const { computeDailyMetrics } = await import("@/lib/metrics");
        await computeDailyMetrics(conn.userId, localYmd(startDate));
        // Newly arrived sleep must reach the morning brief today, not tomorrow.
        const { onWellnessDataChanged } =
          await import("@/lib/sync/wellness-changed");
        await onWellnessDataChanged(conn.userId);
      }
      refreshed++;
    } catch (err) {
      logger.warn("wellness refresh failed", {
        userId: conn.userId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return refreshed;
}
