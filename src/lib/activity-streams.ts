/**
 * Lazy activity-detail loader: streams + laps are fetched from intervals.icu
 * on first view and cached in activity_streams (laps under type "intervals").
 */
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { logger } from "@/lib/logger";
import {
  fetchActivityIntervals,
  fetchActivityStreams,
} from "@/lib/connectors/intervals";

export interface ActivityLap {
  index: number;
  label: string | null;
  durationS: number | null;
  distanceM: number | null;
  avgHr: number | null;
  avgPower: number | null;
}

export interface ActivityDetail {
  activity: typeof schema.activities.$inferSelect;
  streams: Record<string, (number | null)[]> | null;
  laps: ActivityLap[] | null;
  reason?: "unavailable" | "fetch_failed";
}

const LAPS_TYPE = "intervals";

export async function getOrFetchActivityDetail(
  userId: string,
  activityId: string
): Promise<ActivityDetail | null> {
  const activity = await db.query.activities.findFirst({
    where: and(
      eq(schema.activities.id, activityId),
      eq(schema.activities.userId, userId)
    ),
  });
  if (!activity) return null;

  const cached = await db.query.activityStreams.findMany({
    where: eq(schema.activityStreams.activityId, activity.id),
  });
  if (cached.length > 0) return fromRows(activity, cached);

  if (activity.provider !== "intervals_icu") {
    return { activity, streams: null, laps: null, reason: "unavailable" };
  }

  const connection = await db.query.connections.findFirst({
    where: and(
      eq(schema.connections.userId, userId),
      eq(schema.connections.provider, "intervals_icu")
    ),
  });
  if (!connection) {
    return { activity, streams: null, laps: null, reason: "unavailable" };
  }

  try {
    const apiKey = decrypt(connection.encryptedAccessToken);
    const [streams, laps] = await Promise.all([
      fetchActivityStreams({ apiKey, externalId: activity.externalId }),
      fetchActivityIntervals({ apiKey, externalId: activity.externalId }),
    ]);
    const rows: { activityId: string; type: string; data: unknown }[] = [
      ...streams.map((s) => ({
        activityId: activity.id,
        type: s.type,
        data: s.data as unknown,
      })),
      { activityId: activity.id, type: LAPS_TYPE, data: laps as unknown },
    ];
    for (const row of rows) {
      await db
        .insert(schema.activityStreams)
        .values(row)
        .onConflictDoUpdate({
          target: [
            schema.activityStreams.activityId,
            schema.activityStreams.type,
          ],
          set: { data: row.data },
        });
    }
    const streamMap: Record<string, (number | null)[]> = {};
    for (const s of streams) streamMap[s.type] = s.data;
    return {
      activity,
      streams: Object.keys(streamMap).length > 0 ? streamMap : null,
      laps,
      reason: Object.keys(streamMap).length > 0 ? undefined : "unavailable",
    };
  } catch (err) {
    logger.error("activity stream fetch failed", {
      activityId: activity.id,
      message: err instanceof Error ? err.message : String(err),
    });
    return { activity, streams: null, laps: null, reason: "fetch_failed" };
  }
}

function fromRows(
  activity: typeof schema.activities.$inferSelect,
  rows: (typeof schema.activityStreams.$inferSelect)[]
): ActivityDetail {
  const streams: Record<string, (number | null)[]> = {};
  let laps: ActivityLap[] | null = null;
  for (const row of rows) {
    if (row.type === LAPS_TYPE) laps = row.data as ActivityLap[];
    else streams[row.type] = row.data as (number | null)[];
  }
  const hasStreams = Object.keys(streams).length > 0;
  return {
    activity,
    streams: hasStreams ? streams : null,
    laps,
    reason: hasStreams ? undefined : "unavailable",
  };
}
