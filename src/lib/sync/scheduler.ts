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
    // google_calendar doesn't use sync_jobs (no incremental sync pipeline yet)
    if (c.provider === "google_calendar") continue;

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
    // google_calendar doesn't use sync_jobs (no incremental sync pipeline yet)
    if (c.provider === "google_calendar") continue;

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
      // v0.6 auto-describe — pushes metric descriptions to Strava for
      // opted-in users. Guards inside; errors never touch the sync job.
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

  if (claimed.length > 0) {
    logger.info("scheduler tick", { claimed: claimed.length, failed });
  }
  return { claimed: claimed.length, failed };
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
