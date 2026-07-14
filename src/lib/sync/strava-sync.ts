import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { decrypt, encrypt } from "@/lib/crypto";
import { logger } from "@/lib/logger";
import {
  fetchActivities,
  refreshTokens,
  StravaError,
  type StravaTokens,
} from "@/lib/connectors/strava";

const BACKFILL_DAYS = 90;
const INCREMENTAL_OVERLAP_DAYS = 7;
const REFRESH_MARGIN_S = 300;
/** Advisory-lock namespace for Strava token refresh (distinct from scheduler). */
const REFRESH_LOCK_NS = 727_100;

type Connection = typeof schema.connections.$inferSelect;

/** Small stable int from a uuid for the advisory-lock key pair. */
function lockKey(id: string): number {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return h;
}

/**
 * Return a valid access token, refreshing under a pg advisory lock so
 * concurrent syncs never race Strava's single-use refresh tokens.
 */
export async function getValidStravaAccessToken(
  connection: Connection
): Promise<string> {
  const expiresAt = connection.expiresAt?.getTime() ?? 0;
  if (expiresAt > Date.now() + REFRESH_MARGIN_S * 1000) {
    return decrypt(connection.encryptedAccessToken);
  }

  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(${REFRESH_LOCK_NS}, ${lockKey(connection.id)})`
    );

    // Another runner may have refreshed while we waited for the lock.
    const fresh = await tx.query.connections.findFirst({
      where: eq(schema.connections.id, connection.id),
    });
    if (!fresh?.encryptedRefreshToken) {
      throw new StravaError("auth", "Strava connection has no refresh token");
    }
    const freshExpiry = fresh.expiresAt?.getTime() ?? 0;
    if (freshExpiry > Date.now() + REFRESH_MARGIN_S * 1000) {
      return decrypt(fresh.encryptedAccessToken);
    }

    const tokens: StravaTokens = await refreshTokens(
      decrypt(fresh.encryptedRefreshToken)
    );
    await tx
      .update(schema.connections)
      .set({
        encryptedAccessToken: encrypt(tokens.accessToken),
        encryptedRefreshToken: encrypt(tokens.refreshToken),
        expiresAt: new Date(tokens.expiresAt * 1000),
        status: "active",
        lastError: null,
      })
      .where(eq(schema.connections.id, fresh.id));

    logger.info("strava tokens refreshed", { connectionId: fresh.id });
    return tokens.accessToken;
  });
}

export interface StravaSyncResult {
  activities: number;
  windowStart: string;
}

/** Pull Strava activity summaries for one user and upsert. Streams stay lazy. */
export async function runStravaSync(userId: string): Promise<StravaSyncResult> {
  const connection = await db.query.connections.findFirst({
    where: and(
      eq(schema.connections.userId, userId),
      eq(schema.connections.provider, "strava")
    ),
  });
  if (!connection) throw new Error("No Strava connection for this user.");

  const since = new Date();
  if (connection.lastSyncAt) {
    since.setTime(connection.lastSyncAt.getTime());
    since.setDate(since.getDate() - INCREMENTAL_OVERLAP_DAYS);
  } else {
    since.setDate(since.getDate() - BACKFILL_DAYS);
  }

  try {
    const accessToken = await getValidStravaAccessToken(connection);
    const afterEpochS = Math.floor(since.getTime() / 1000);

    let page = 1;
    let total = 0;
    for (;;) {
      const batch = await fetchActivities({ accessToken, afterEpochS, page });
      for (const activity of batch) {
        await db
          .insert(schema.activities)
          .values({
            userId,
            provider: "strava",
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
        total++;
      }
      if (batch.length < 100) break;
      page++;
    }

    await db
      .update(schema.connections)
      .set({ lastSyncAt: new Date(), status: "active", lastError: null })
      .where(eq(schema.connections.id, connection.id));

    logger.info("strava sync complete", { userId, activities: total });
    return {
      activities: total,
      windowStart: since.toISOString().slice(0, 10),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("strava sync failed", { userId, error: message });
    await db
      .update(schema.connections)
      .set({
        status:
          err instanceof StravaError && err.code === "auth"
            ? "error"
            : connection.status,
        lastError: message,
      })
      .where(eq(schema.connections.id, connection.id));
    throw err;
  }
}
