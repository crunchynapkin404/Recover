import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { logger } from "@/lib/logger";

/** Arbitrary app-wide advisory lock key for the scheduler tick. */
const TICK_LOCK_KEY = 727_001;
/** A job stuck in "running" longer than this is presumed crashed and reclaimed. */
const STALE_RUNNING_MINUTES = 15;
const MAX_ATTEMPTS = 5;
/** Daily sync hour (server-local). */
const SYNC_HOUR = 5;

type SyncJob = typeof schema.syncJobs.$inferSelect;

export type JobProcessor = (job: SyncJob) => Promise<void>;

async function defaultProcessor(job: SyncJob): Promise<void> {
  if (job.provider === "intervals_icu") {
    const { runIntervalsSync } = await import("@/lib/sync/intervals-sync");
    await runIntervalsSync(job.userId);
    return;
  }
  if (job.provider === "strava") {
    const { runStravaSync } = await import("@/lib/sync/strava-sync");
    await runStravaSync(job.userId);
    return;
  }
  if (job.provider === "whoop") {
    const { runWhoopSync } = await import("@/lib/sync/whoop-sync");
    await runWhoopSync(job.userId);
    return;
  }
  if (job.provider === "oura") {
    const { runOuraSync } = await import("@/lib/sync/oura-sync");
    await runOuraSync(job.userId);
    return;
  }
  if (job.provider === "withings") {
    const { runWithingsSync } = await import("@/lib/sync/withings-sync");
    await runWithingsSync(job.userId);
    return;
  }
  throw new Error(`No processor for provider ${job.provider}`);
}

function nextMorning(): Date {
  const next = new Date();
  next.setHours(SYNC_HOUR, 0, 0, 0);
  if (next <= new Date()) next.setDate(next.getDate() + 1);
  // Jitter ±10 min so multiple users never hit provider APIs in the same second.
  next.setMinutes(next.getMinutes() + Math.floor(Math.random() * 20) - 10);
  return next;
}

/** Ensure every active connection has a pending sync job. */
export async function ensureJobsForConnections(): Promise<void> {
  const connections = await db.query.connections.findMany({
    where: eq(schema.connections.status, "active"),
    columns: { userId: true, provider: true },
  });

  for (const c of connections) {
    // google_calendar has no pull pipeline; apple_health is push-only
    // (Health Auto Export webhook / file upload) — neither uses sync_jobs.
    if (c.provider === "google_calendar" || c.provider === "apple_health")
      continue;

    const existing = await db.query.syncJobs.findFirst({
      where: and(
        eq(schema.syncJobs.userId, c.userId),
        eq(schema.syncJobs.provider, c.provider),
        inArray(schema.syncJobs.status, ["pending", "running"])
      ),
      columns: { id: true },
    });
    if (!existing) {
      await db.insert(schema.syncJobs).values({
        userId: c.userId,
        provider: c.provider,
        kind: "incremental",
        runAfter: nextMorning(),
      });
    }
  }
}

/**
 * Make the user's next sync happen now: pull pending jobs forward, or create
 * incremental jobs for active connections that have none. The caller then
 * runs a tick.
 */
export async function requestImmediateSync(userId: string): Promise<void> {
  const conns = await db.query.connections.findMany({
    where: and(
      eq(schema.connections.userId, userId),
      eq(schema.connections.status, "active")
    ),
    columns: { provider: true },
  });

  for (const c of conns) {
    // google_calendar has no pull pipeline; apple_health is push-only.
    if (c.provider === "google_calendar" || c.provider === "apple_health")
      continue;

    const bumped = await db
      .update(schema.syncJobs)
      .set({ runAfter: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(schema.syncJobs.userId, userId),
          eq(schema.syncJobs.provider, c.provider),
          eq(schema.syncJobs.status, "pending")
        )
      )
      // Parameterless: the dual-driver union type only shares this overload.
      .returning();

    if (bumped.length === 0) {
      const running = await db.query.syncJobs.findFirst({
        where: and(
          eq(schema.syncJobs.userId, userId),
          eq(schema.syncJobs.provider, c.provider),
          eq(schema.syncJobs.status, "running")
        ),
        columns: { id: true },
      });
      if (!running) {
        await db.insert(schema.syncJobs).values({
          userId,
          provider: c.provider,
          kind: "incremental",
          runAfter: new Date(),
        });
      }
    }
  }
}

/**
 * Bring the user's intervals.icu sync forward to `delayS` seconds from now
 * — or leave it alone if one's already scheduled at least that soon. Used
 * by the Strava webhook (src/lib/sync/strava-webhook.ts) to react to a new
 * ride without waiting for the 15-min activity poll or the daily sync. The
 * delay gives intervals.icu's own Strava ingestion a head start, since a
 * pull that runs before intervals.icu has the ride would just miss it.
 * No-ops if the user has no active intervals.icu connection, or a sync for
 * it is already running. Returns whether a job was actually created or
 * brought forward, so callers (e.g. the Strava webhook) can tell a real
 * schedule from a no-op.
 */
export async function scheduleIntervalsSync(
  userId: string,
  delayS = 0
): Promise<boolean> {
  const connection = await db.query.connections.findFirst({
    where: and(
      eq(schema.connections.userId, userId),
      eq(schema.connections.provider, "intervals_icu"),
      eq(schema.connections.status, "active")
    ),
    columns: { id: true },
  });
  if (!connection) return false;

  const runAfter = new Date(Date.now() + delayS * 1000);

  const existing = await db.query.syncJobs.findFirst({
    where: and(
      eq(schema.syncJobs.userId, userId),
      eq(schema.syncJobs.provider, "intervals_icu"),
      inArray(schema.syncJobs.status, ["pending", "running"])
    ),
  });
  if (existing?.status === "running") return false;
  if (existing) {
    if (existing.runAfter <= runAfter) return false;
    await db
      .update(schema.syncJobs)
      .set({ runAfter, updatedAt: new Date() })
      .where(eq(schema.syncJobs.id, existing.id));
    return true;
  }

  await db.insert(schema.syncJobs).values({
    userId,
    provider: "intervals_icu",
    kind: "incremental",
    runAfter,
  });
  return true;
}

/** Most recent lastSyncAt across all of a user's connections, or null. */
export async function getLastSyncAt(userId: string): Promise<string | null> {
  const conns = await db.query.connections.findMany({
    where: eq(schema.connections.userId, userId),
    columns: { lastSyncAt: true },
  });
  const last = conns
    .map((c) => c.lastSyncAt)
    .filter((d): d is Date => d != null)
    .sort((a, b) => b.getTime() - a.getTime())[0];
  return last?.toISOString() ?? null;
}

/**
 * One scheduler tick: claim due jobs (single runner via pg advisory lock,
 * SKIP LOCKED against concurrent claimers, stale-"running" reclaim) and
 * process them. Safe to call from both the in-process interval and /api/cron.
 * pg driver only — the Neon HTTP driver has no advisory locks (docs/PLAN.md).
 */
export async function runSchedulerTick(
  processor: JobProcessor = defaultProcessor
): Promise<{ claimed: number; failed: number }> {
  if (process.env.DATABASE_DRIVER !== "pg") {
    logger.warn("scheduler tick skipped: requires DATABASE_DRIVER=pg");
    return { claimed: 0, failed: 0 };
  }

  const staleCutoff = new Date(Date.now() - STALE_RUNNING_MINUTES * 60_000);

  const claimed = await db.transaction(async (tx) => {
    const lock = await tx.execute(
      sql`SELECT pg_try_advisory_xact_lock(${TICK_LOCK_KEY}) AS locked`
    );
    if (!(lock.rows[0] as { locked: boolean }).locked) return [] as SyncJob[];

    const due = await tx.execute(sql`
      SELECT id FROM sync_jobs
      WHERE (status = 'pending' AND run_after <= now())
         OR (status = 'running' AND updated_at < ${staleCutoff})
      ORDER BY run_after ASC
      LIMIT 10
      FOR UPDATE SKIP LOCKED
    `);
    const ids = (due.rows as { id: string }[]).map((r) => r.id);
    if (ids.length === 0) return [] as SyncJob[];

    return tx
      .update(schema.syncJobs)
      .set({ status: "running", updatedAt: new Date() })
      .where(inArray(schema.syncJobs.id, ids))
      .returning();
  });

  let failed = 0;
  for (const job of claimed) {
    try {
      await processor(job);
      await db
        .update(schema.syncJobs)
        .set({ status: "done", updatedAt: new Date(), lastError: null })
        .where(eq(schema.syncJobs.id, job.id));
      // Chain the next daily run.
      await db.insert(schema.syncJobs).values({
        userId: job.userId,
        provider: job.provider,
        kind: "incremental",
        runAfter: nextMorning(),
      });
      // v0.9.2 daily plan adaptation — must run before the morning insight
      // so the insight can explain today's changes. Guards inside.
      try {
        const { runDailyAdaptation } = await import("@/lib/week-plan/service");
        await runDailyAdaptation(job.userId);
      } catch (err) {
        logger.error("daily plan adaptation failed", {
          userId: job.userId,
          message: err instanceof Error ? err.message : String(err),
        });
      }
      // Morning coach insight — must run before the push so the teaser
      // exists; guards inside make it at-most-once/day, errors never
      // touch the sync job.
      try {
        const { generateMorningInsight } =
          await import("@/lib/morning-insight");
        await generateMorningInsight(job.userId);
      } catch (err) {
        logger.error("morning insight failed", {
          userId: job.userId,
          message: err instanceof Error ? err.message : String(err),
        });
      }
      // Morning readiness push — guards inside make this at-most-once/day.
      try {
        const { maybeSendMorningReadinessPush } = await import("@/lib/push");
        await maybeSendMorningReadinessPush(job.userId);
      } catch (err) {
        logger.error("morning push hook failed", {
          userId: job.userId,
          message: err instanceof Error ? err.message : String(err),
        });
      }
      // Weekly review — guards inside ensure at-most-once/week.
      try {
        const { generateWeeklyReview } = await import("@/lib/weekly-review");
        await generateWeeklyReview(job.userId);
      } catch (err) {
        logger.error("weekly review failed", {
          userId: job.userId,
          message: err instanceof Error ? err.message : String(err),
        });
      }
      // v0.15 monthly report — guards inside ensure at-most-once/month.
      try {
        const { generateMonthlyReport } = await import("@/lib/monthly-report");
        await generateMonthlyReport(job.userId);
      } catch (err) {
        logger.error("monthly report failed", {
          userId: job.userId,
          message: err instanceof Error ? err.message : String(err),
        });
      }
      // v0.14 post-race debrief — guards inside make it once per race.
      try {
        const { runRaceDebriefs } = await import("@/lib/race/debrief");
        await runRaceDebriefs(job.userId);
      } catch (err) {
        logger.error("race debrief failed", {
          userId: job.userId,
          message: err instanceof Error ? err.message : String(err),
        });
      }
      // v0.15 debrief lifecycle — covers overnight uploads the poll slept
      // through. Guards inside; never touches the sync job.
      try {
        const { runDebriefLifecycle } = await import("@/lib/debrief/lifecycle");
        await runDebriefLifecycle(job.userId);
      } catch (err) {
        logger.error("debrief lifecycle hook failed", {
          userId: job.userId,
          message: err instanceof Error ? err.message : String(err),
        });
      }
      // v0.6 auto-describe — pushes metric descriptions to Strava for
      // opted-in users. This is a catch-up sweep only: describing a brand
      // new activity here (same tick it's promoted to a pending debrief,
      // above) would lock in a description with no review — the MARKER
      // makes that permanent, so describeActivityOnStrava's awaiting_review
      // guard defers those and the real write happens right after the
      // review posts (generateRideReview/runRaceDebriefs call
      // describeActivityOnStravaForUser directly). Guards inside; errors
      // never touch the sync job.
      if (job.provider === "intervals_icu") {
        try {
          const { runAutoDescribeStrava } =
            await import("@/lib/strava-describer");
          await runAutoDescribeStrava(job.userId);
        } catch (err) {
          logger.error("auto-describe failed", {
            userId: job.userId,
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
    } catch (err) {
      failed++;
      const message = err instanceof Error ? err.message : String(err);
      const attempts = job.attempts + 1;
      const giveUp = attempts >= MAX_ATTEMPTS;
      await db
        .update(schema.syncJobs)
        .set({
          status: giveUp ? "failed" : "pending",
          attempts,
          lastError: message,
          // Exponential backoff: 2, 4, 8, 16 minutes.
          runAfter: new Date(Date.now() + 2 ** attempts * 60_000),
          updatedAt: new Date(),
        })
        .where(eq(schema.syncJobs.id, job.id));
      logger.error("sync job failed", { jobId: job.id, attempts, message });
    }
  }

  // Ghost-thread housekeeping — guarded like the push hook: never break the tick.
  try {
    const purged = await purgeEphemeralThreads();
    if (purged > 0) logger.info("ghost threads purged", { purged });
  } catch (err) {
    logger.error("ghost purge failed", {
      message: err instanceof Error ? err.message : String(err),
    });
  }

  // v0.12.2 EMA decay refresh — guarded the same way.
  try {
    const refreshed = await refreshDailyDecay();
    if (refreshed > 0) logger.info("daily decay refreshed", { refreshed });
  } catch (err) {
    logger.error("daily decay refresh failed", {
      message: err instanceof Error ? err.message : String(err),
    });
  }

  // v0.15 activity poll — near-real-time ride detection; guarded like the
  // rest, never breaks the tick.
  try {
    const { runActivityPolls } = await import("@/lib/sync/activity-poll");
    const polled = await runActivityPolls();
    if (polled > 0) logger.info("activity polls ran", { polled });
  } catch (err) {
    logger.error("activity poll pass failed", {
      message: err instanceof Error ? err.message : String(err),
    });
  }

  if (claimed.length > 0) {
    logger.info("scheduler tick", { claimed: claimed.length, failed });
  }
  return { claimed: claimed.length, failed };
}

/**
 * Refresh today's daily_metrics for users nothing else will touch today
 * (v0.12.2 audit fix). CTL/ATL are EMAs that must decay through restful
 * days, but computeDailyMetrics only ran from sync and write paths — a
 * manual-only athlete's dashboard froze at its last-written values. Any
 * user with metrics history but no row for today gets one recompute; the
 * recompute writes today's row, so each user runs at most once per day.
 */
export async function refreshDailyDecay(): Promise<number> {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const stale = await db.execute(sql`
    SELECT DISTINCT user_id FROM daily_metrics dm
    WHERE NOT EXISTS (
      SELECT 1 FROM daily_metrics d2
      WHERE d2.user_id = dm.user_id AND d2.date >= ${today}
    )
    LIMIT 100
  `);
  const userIds = (stale.rows as { user_id: string }[]).map((r) => r.user_id);
  if (userIds.length === 0) return 0;

  const { computeDailyMetrics } = await import("@/lib/metrics");
  let refreshed = 0;
  for (const userId of userIds) {
    try {
      await computeDailyMetrics(userId, today);
      refreshed++;
    } catch (err) {
      logger.error("decay refresh failed for user", {
        userId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return refreshed;
}

/** Delete ghost (ephemeral) threads idle for 24h; messages cascade. */
export async function purgeEphemeralThreads(): Promise<number> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await db
    .delete(schema.chatThreads)
    .where(
      and(
        eq(schema.chatThreads.ephemeral, true),
        lt(schema.chatThreads.updatedAt, cutoff)
      )
    )
    .returning();
  return rows.length;
}
