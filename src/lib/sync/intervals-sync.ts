import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { logger } from "@/lib/logger";
import {
  ConnectorError,
  fetchActivities,
  fetchDailyWellness,
  type IntervalsActivity,
} from "@/lib/connectors/intervals";
import { applyWellnessPatch } from "@/lib/wellness-merge";

const BACKFILL_DAYS = 365;
const INCREMENTAL_OVERLAP_DAYS = 7;

export interface SyncResult {
  wellnessDays: number;
  activities: number;
  windowStart: string;
  windowEnd: string;
}

/** Upsert intervals.icu activities (shared by the daily sync and the v0.15
 * activity poll). Conflict target (userId, provider, externalId). */
export async function upsertIntervalsActivities(
  userId: string,
  activities: IntervalsActivity[]
): Promise<void> {
  for (const activity of activities) {
    await db
      .insert(schema.activities)
      .values({
        userId,
        provider: "intervals_icu",
        externalId: activity.externalId,
        startDate: activity.startDate,
        sport: activity.sport,
        name: activity.name,
        durationS: activity.durationS,
        distanceM: activity.distanceM,
        load: activity.load,
        avgHr: activity.avgHr,
        avgPower: activity.avgPower,
        elevationM: activity.elevationM,
        raw: activity.raw,
      })
      .onConflictDoUpdate({
        target: [
          schema.activities.userId,
          schema.activities.provider,
          schema.activities.externalId,
        ],
        set: {
          startDate: activity.startDate,
          sport: activity.sport,
          name: activity.name,
          durationS: activity.durationS,
          distanceM: activity.distanceM,
          load: activity.load,
          avgHr: activity.avgHr,
          avgPower: activity.avgPower,
          elevationM: activity.elevationM,
          raw: activity.raw,
        },
      });
  }
}

/**
 * Pull wellness + activities from intervals.icu for one user and upsert.
 * First sync backfills BACKFILL_DAYS; later syncs re-fetch a small overlap
 * window so late-arriving edits (sleep scores, corrected activities) heal.
 */
export async function runIntervalsSync(userId: string): Promise<SyncResult> {
  const connection = await db.query.connections.findFirst({
    where: and(
      eq(schema.connections.userId, userId),
      eq(schema.connections.provider, "intervals_icu")
    ),
  });
  if (!connection) {
    throw new Error("No intervals.icu connection for this user.");
  }

  const apiKey = decrypt(connection.encryptedAccessToken);
  const athleteId = connection.externalAthleteId;

  const endDate = new Date();
  const startDate = new Date();
  if (connection.lastSyncAt) {
    startDate.setTime(connection.lastSyncAt.getTime());
    startDate.setDate(startDate.getDate() - INCREMENTAL_OVERLAP_DAYS);
  } else {
    startDate.setDate(startDate.getDate() - BACKFILL_DAYS);
  }

  try {
    const [wellness, activities] = await Promise.all([
      fetchDailyWellness({ apiKey, athleteId, startDate, endDate }),
      fetchActivities({ apiKey, athleteId, startDate, endDate }),
    ]);

    for (const day of wellness) {
      if (!day.date) continue;
      // v0.11: through the per-field merge — a whole-row upsert here would
      // null out fields another provider (Whoop/Oura) owns for the day.
      await applyWellnessPatch(
        userId,
        day.date,
        {
          hrvMs: day.hrv,
          restingHr: day.restingHr,
          sleepSecs: day.sleepSecs,
          sleepScore: day.sleepScore,
          ctl: day.ctl,
          atl: day.atl,
          eftp: day.eftp,
          vo2max: day.vo2max,
          rampRate: day.rampRate,
          pMax: day.pMax,
          wPrime: day.wPrime,
          weightKg: day.weight,
        },
        "intervals_icu",
        day.raw
      );
    }

    await upsertIntervalsActivities(userId, activities);

    await db
      .update(schema.connections)
      .set({ lastSyncAt: endDate, status: "active", lastError: null })
      .where(eq(schema.connections.id, connection.id));

    // Readiness depends on trailing baselines, so recompute from the start
    // of the freshly synced window onward.
    const { computeDailyMetrics } = await import("@/lib/metrics");
    await computeDailyMetrics(userId, startDate.toISOString().slice(0, 10));

    logger.info("intervals sync complete", {
      userId,
      wellnessDays: wellness.length,
      activities: activities.length,
      windowStart: startDate.toISOString().slice(0, 10),
    });

    return {
      wellnessDays: wellness.length,
      activities: activities.length,
      windowStart: startDate.toISOString().slice(0, 10),
      windowEnd: endDate.toISOString().slice(0, 10),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("intervals sync failed", { userId, error: message });
    await db
      .update(schema.connections)
      .set({
        status:
          err instanceof ConnectorError && err.code === "auth_expired"
            ? "error"
            : "active",
        lastError: message,
      })
      .where(eq(schema.connections.id, connection.id));
    throw err;
  }
}
