/**
 * v0.15 activity poll — near-real-time ride detection. intervals.icu has no
 * webhooks (sync is pull-only), so every POLL_INTERVAL_MIN we fetch the
 * recent activity list for users with the ride-debrief loop enabled. Runs as
 * a guarded housekeeping pass on the scheduler tick — NOT as a sync_jobs row
 * (a perpetually-pending poll job would suppress ensureJobsForConnections'
 * duplicate guard for the daily sync).
 *
 * Quiet 23:00–06:00 server-local: the 05:00 full sync covers the night.
 */
import { and, eq, inArray, isNull, lt, or } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { logger } from "@/lib/logger";
import { decrypt } from "@/lib/crypto";
import {
  fetchActivities,
  type IntervalsActivity,
} from "@/lib/connectors/intervals";
import { upsertIntervalsActivities } from "@/lib/sync/intervals-sync";

export const POLL_INTERVAL_MIN = 15;
export const POLL_LOOKBACK_HOURS = 24;
export const POLL_QUIET_START_HOUR = 23;
export const POLL_QUIET_END_HOUR = 6;

export type ActivityFetcher = (params: {
  apiKey: string;
  athleteId: string;
  startDate: Date;
  endDate: Date;
}) => Promise<IntervalsActivity[]>;

export function pollWindowOpen(now: Date): boolean {
  const h = now.getHours();
  return h >= POLL_QUIET_END_HOUR && h < POLL_QUIET_START_HOUR;
}

function localYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Poll every due intervals.icu connection. Returns how many users polled.
 *
 * `userIds`, when given, additionally restricts the DB-wide connections
 * query to that set — this is a test-only safety valve. This function's
 * production call site (scheduler.ts) always calls it with no options, so
 * this restriction never applies outside tests. It exists because this is
 * the only DB-wide guarded scheduler pass that also accepts a caller-
 * injected data source (`fetcher`) whose return value gets written verbatim
 * into whatever real rows the query matches — unlike `refreshDailyDecay` or
 * `purgeEphemeralThreads`, which touch real data too but only ever
 * recompute-from-real-inputs or delete-expired, never write test-supplied
 * content. Omitting this scoping let a test run against a shared dev/live
 * database (this repo's DB-gated tests have no separate test database)
 * write fixture data into whichever real connections happened to be due.
 */
export async function runActivityPolls(opts?: {
  now?: Date;
  fetcher?: ActivityFetcher;
  userIds?: string[];
}): Promise<number> {
  const now = opts?.now ?? new Date();
  if (!pollWindowOpen(now)) return 0;
  const fetcher = opts?.fetcher ?? fetchActivities;
  const dueBefore = new Date(now.getTime() - POLL_INTERVAL_MIN * 60_000);

  const conns = await db.query.connections.findMany({
    where: and(
      eq(schema.connections.provider, "intervals_icu"),
      eq(schema.connections.status, "active"),
      or(
        isNull(schema.connections.lastActivityPollAt),
        lt(schema.connections.lastActivityPollAt, dueBefore)
      ),
      opts?.userIds
        ? inArray(schema.connections.userId, opts.userIds)
        : undefined
    ),
  });

  let polled = 0;
  for (const conn of conns) {
    const prefs = await db.query.notificationPrefs.findFirst({
      where: eq(schema.notificationPrefs.userId, conn.userId),
    });
    if (prefs && !prefs.rideDebriefsEnabled) continue; // loop switched off

    // Stamp the cursor first, success or failure — a broken API key must
    // not tight-loop against intervals.icu every tick.
    await db
      .update(schema.connections)
      .set({ lastActivityPollAt: now })
      .where(eq(schema.connections.id, conn.id));

    try {
      const startDate = new Date(
        now.getTime() - POLL_LOOKBACK_HOURS * 3_600_000
      );
      const list = await fetcher({
        apiKey: decrypt(conn.encryptedAccessToken),
        athleteId: conn.externalAthleteId,
        startDate,
        endDate: now,
      });
      if (list.length > 0) {
        await upsertIntervalsActivities(conn.userId, list);
        const { computeDailyMetrics } = await import("@/lib/metrics");
        await computeDailyMetrics(conn.userId, localYmd(startDate));
      }
      polled++;
      const { runDebriefLifecycle } = await import("@/lib/debrief/lifecycle");
      await runDebriefLifecycle(conn.userId, { now });
    } catch (err) {
      logger.warn("activity poll failed", {
        userId: conn.userId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return polled;
}
