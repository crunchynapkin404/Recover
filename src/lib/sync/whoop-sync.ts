import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { decrypt, encrypt } from "@/lib/crypto";
import { logger } from "@/lib/logger";
import {
  fetchRecoveries,
  fetchSleeps,
  mapWhoopDays,
  refreshTokens,
  WhoopError,
  type WhoopTokens,
} from "@/lib/connectors/whoop";
import { applyWellnessPatch } from "@/lib/wellness-merge";

const BACKFILL_DAYS = 90;
const INCREMENTAL_OVERLAP_DAYS = 7;
const REFRESH_MARGIN_S = 300;
/** Advisory-lock namespace for Whoop token refresh (distinct from Strava's). */
const REFRESH_LOCK_NS = 727_200;

type Connection = typeof schema.connections.$inferSelect;

function lockKey(id: string): number {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return h;
}

/**
 * Return a valid access token, refreshing under a pg advisory lock —
 * Whoop refresh tokens rotate, so concurrent refreshes would strand the
 * connection (same failure mode as Strava's single-use refresh tokens).
 */
export async function getValidWhoopAccessToken(
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

    const fresh = await tx.query.connections.findFirst({
      where: eq(schema.connections.id, connection.id),
    });
    if (!fresh?.encryptedRefreshToken) {
      throw new WhoopError("auth", "Whoop connection has no refresh token");
    }
    const freshExpiry = fresh.expiresAt?.getTime() ?? 0;
    if (freshExpiry > Date.now() + REFRESH_MARGIN_S * 1000) {
      return decrypt(fresh.encryptedAccessToken);
    }

    const tokens: WhoopTokens = await refreshTokens(
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

    logger.info("whoop tokens refreshed", { connectionId: fresh.id });
    return tokens.accessToken;
  });
}

export interface WhoopSyncResult {
  wellnessDays: number;
  windowStart: string;
}

/**
 * Pull Whoop recovery + staged sleep for one user and merge into
 * wellness_daily via the per-field policy, then recompute daily metrics
 * once over the synced window.
 */
export async function runWhoopSync(userId: string): Promise<WhoopSyncResult> {
  const connection = await db.query.connections.findFirst({
    where: and(
      eq(schema.connections.userId, userId),
      eq(schema.connections.provider, "whoop")
    ),
  });
  if (!connection) throw new Error("No Whoop connection for this user.");

  const end = new Date();
  const start = new Date();
  if (connection.lastSyncAt) {
    start.setTime(connection.lastSyncAt.getTime());
    start.setDate(start.getDate() - INCREMENTAL_OVERLAP_DAYS);
  } else {
    start.setDate(start.getDate() - BACKFILL_DAYS);
  }

  try {
    const accessToken = await getValidWhoopAccessToken(connection);
    const [sleeps, recoveries] = await Promise.all([
      fetchSleeps(accessToken, start, end),
      fetchRecoveries(accessToken, start, end),
    ]);

    const days = mapWhoopDays(sleeps, recoveries);
    for (const [date, patch] of days) {
      await applyWellnessPatch(userId, date, patch, "whoop");
    }

    await db
      .update(schema.connections)
      .set({ lastSyncAt: end, status: "active", lastError: null })
      .where(eq(schema.connections.id, connection.id));

    const { computeDailyMetrics } = await import("@/lib/metrics");
    await computeDailyMetrics(userId, start.toISOString().slice(0, 10));

    logger.info("whoop sync complete", {
      userId,
      wellnessDays: days.size,
      windowStart: start.toISOString().slice(0, 10),
    });
    return {
      wellnessDays: days.size,
      windowStart: start.toISOString().slice(0, 10),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("whoop sync failed", { userId, error: message });
    await db
      .update(schema.connections)
      .set({
        status:
          err instanceof WhoopError && err.code === "auth"
            ? "error"
            : connection.status,
        lastError: message,
      })
      .where(eq(schema.connections.id, connection.id));
    throw err;
  }
}
