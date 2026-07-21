/**
 * v0.20 — shared ops snapshot for /api/health and /api/metrics. Both
 * endpoints report the same underlying signals (sync staleness, job queue
 * health, backup freshness); this keeps the query logic in one place so
 * they can't drift.
 */
import { count, desc, eq, isNotNull } from "drizzle-orm";
import { db, schema } from "@/lib/db";

export const BACKUP_LAST_SUCCESS_KEY = "backup_last_success_at";

export interface OpsSnapshot {
  /** Seconds since the most recent successful connector sync, or null if none has ever completed. */
  lastSyncAgeS: number | null;
  /** Sync jobs currently queued (status=pending). */
  jobsPending: number;
  /** Sync jobs currently in flight (status=running). */
  jobsRunning: number;
  /** Sync jobs currently in a failed state (point-in-time count). */
  jobsFailed: number;
  /** Seconds since the last successful backup rotation, or null if none has ever been reported. */
  backupAgeS: number | null;
  /** Registered web-push subscriptions (proxy for push reach; delivery-failure state isn't tracked in the schema). */
  pushSubscriptions: number;
}

export async function getOpsSnapshot(): Promise<OpsSnapshot> {
  const [latestSync, jobCounts, backupRow, pushCountRows] = await Promise.all([
    db.query.connections.findFirst({
      where: isNotNull(schema.connections.lastSyncAt),
      orderBy: desc(schema.connections.lastSyncAt),
      columns: { lastSyncAt: true },
    }),
    db
      .select({ status: schema.syncJobs.status, n: count() })
      .from(schema.syncJobs)
      .groupBy(schema.syncJobs.status),
    db.query.appConfig.findFirst({
      where: eq(schema.appConfig.key, BACKUP_LAST_SUCCESS_KEY),
    }),
    db.select({ n: count() }).from(schema.pushSubscriptions),
  ]);

  const lastSyncAgeS = latestSync?.lastSyncAt
    ? Math.round((Date.now() - latestSync.lastSyncAt.getTime()) / 1000)
    : null;

  const countFor = (status: string) =>
    Number(jobCounts.find((c) => c.status === status)?.n ?? 0);

  const backupAgeS = backupRow?.value
    ? Math.round(Date.now() / 1000 - Number(backupRow.value))
    : null;

  return {
    lastSyncAgeS,
    jobsPending: countFor("pending"),
    jobsRunning: countFor("running"),
    jobsFailed: countFor("failed"),
    backupAgeS,
    pushSubscriptions: Number(pushCountRows[0]?.n ?? 0),
  };
}
