import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import {
  ConnectorError,
  fetchActivities,
  fetchDailyWellness,
} from "@/lib/connectors/intervals";

const BACKFILL_DAYS = 365;
const INCREMENTAL_OVERLAP_DAYS = 7;

export interface SyncResult {
  wellnessDays: number;
  activities: number;
  windowStart: string;
  windowEnd: string;
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
      await db
        .insert(schema.wellnessDaily)
        .values({
          userId,
          date: day.date,
          hrvMs: day.hrv,
          restingHr: day.restingHr,
          sleepSecs: day.sleepSecs,
          sleepScore: day.sleepScore,
          ctl: day.ctl,
          atl: day.atl,
          eftp: day.eftp,
          weightKg: day.weight,
          source: "intervals_icu",
          raw: day.raw,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [schema.wellnessDaily.userId, schema.wellnessDaily.date],
          set: {
            hrvMs: day.hrv,
            restingHr: day.restingHr,
            sleepSecs: day.sleepSecs,
            sleepScore: day.sleepScore,
            ctl: day.ctl,
            atl: day.atl,
            eftp: day.eftp,
            weightKg: day.weight,
            raw: day.raw,
            updatedAt: new Date(),
          },
        });
    }

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

    await db
      .update(schema.connections)
      .set({ lastSyncAt: endDate, status: "active", lastError: null })
      .where(eq(schema.connections.id, connection.id));

    return {
      wellnessDays: wellness.length,
      activities: activities.length,
      windowStart: startDate.toISOString().slice(0, 10),
      windowEnd: endDate.toISOString().slice(0, 10),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(schema.connections)
      .set({
        status: err instanceof ConnectorError && err.code === "auth_expired" ? "error" : "active",
        lastError: message,
      })
      .where(eq(schema.connections.id, connection.id));
    throw err;
  }
}
