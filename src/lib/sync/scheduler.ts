import { and, eq, inArray, sql } from "drizzle-orm";
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

  if (claimed.length > 0) {
    logger.info("scheduler tick", { claimed: claimed.length, failed });
  }
  return { claimed: claimed.length, failed };
}
