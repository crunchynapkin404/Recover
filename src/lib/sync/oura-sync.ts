import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { logger } from "@/lib/logger";
import {
  fetchDailyReadiness,
  fetchDailySleep,
  fetchSleep,
  mapOuraDays,
  OuraError,
} from "@/lib/connectors/oura";
import { applyWellnessPatch } from "@/lib/wellness-merge";

const BACKFILL_DAYS = 90;
const INCREMENTAL_OVERLAP_DAYS = 7;

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export interface OuraSyncResult {
  wellnessDays: number;
  windowStart: string;
}

/**
 * Pull Oura staged sleep + daily sleep score + readiness for one user and
 * merge into wellness_daily via the per-field policy, then recompute daily
 * metrics once over the synced window.
 */
export async function runOuraSync(userId: string): Promise<OuraSyncResult> {
  const connection = await db.query.connections.findFirst({
    where: and(
      eq(schema.connections.userId, userId),
      eq(schema.connections.provider, "oura")
    ),
  });
  if (!connection) throw new Error("No Oura connection for this user.");

  const end = new Date();
  const start = new Date();
  if (connection.lastSyncAt) {
    start.setTime(connection.lastSyncAt.getTime());
    start.setDate(start.getDate() - INCREMENTAL_OVERLAP_DAYS);
  } else {
    start.setDate(start.getDate() - BACKFILL_DAYS);
  }
  const startDate = ymd(start);
  const endDate = ymd(end);

  try {
    const token = decrypt(connection.encryptedAccessToken);
    const [sleep, dailySleep, readiness] = await Promise.all([
      fetchSleep(token, startDate, endDate),
      fetchDailySleep(token, startDate, endDate),
      fetchDailyReadiness(token, startDate, endDate),
    ]);

    const days = mapOuraDays(sleep, dailySleep, readiness);
    for (const [date, patch] of days) {
      await applyWellnessPatch(userId, date, patch, "oura");
    }

    await db
      .update(schema.connections)
      .set({ lastSyncAt: end, status: "active", lastError: null })
      .where(eq(schema.connections.id, connection.id));

    const { computeDailyMetrics } = await import("@/lib/metrics");
    await computeDailyMetrics(userId, startDate);

    logger.info("oura sync complete", {
      userId,
      wellnessDays: days.size,
      windowStart: startDate,
    });
    return { wellnessDays: days.size, windowStart: startDate };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("oura sync failed", { userId, error: message });
    await db
      .update(schema.connections)
      .set({
        status:
          err instanceof OuraError && err.code === "auth"
            ? "error"
            : connection.status,
        lastError: message,
      })
      .where(eq(schema.connections.id, connection.id));
    throw err;
  }
}
