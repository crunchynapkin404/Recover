import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { decrypt, encrypt } from "@/lib/crypto";
import { logger } from "@/lib/logger";
import {
  fetchMeasures,
  mapWithingsMeasures,
  refreshTokens,
  WithingsError,
  type WithingsTokens,
} from "@/lib/connectors/withings";
import { applyWellnessPatch } from "@/lib/wellness-merge";

const BACKFILL_DAYS = 365;
const INCREMENTAL_OVERLAP_DAYS = 14;
const REFRESH_MARGIN_S = 300;
/** Advisory-lock namespace for Withings token refresh. */
const REFRESH_LOCK_NS = 727_300;

type Connection = typeof schema.connections.$inferSelect;

function lockKey(id: string): number {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return h;
}

/** Valid access token, refreshing under a pg advisory lock (rotating tokens). */
export async function getValidWithingsAccessToken(
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
      throw new WithingsError(
        "auth",
        "Withings connection has no refresh token"
      );
    }
    const freshExpiry = fresh.expiresAt?.getTime() ?? 0;
    if (freshExpiry > Date.now() + REFRESH_MARGIN_S * 1000) {
      return decrypt(fresh.encryptedAccessToken);
    }
    const tokens: WithingsTokens = await refreshTokens(
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
    logger.info("withings tokens refreshed", { connectionId: fresh.id });
    return tokens.accessToken;
  });
}

export interface WithingsSyncResult {
  wellnessDays: number;
  windowStart: string;
}

/** Pull Withings body/BP measures for one user and merge into wellness. */
export async function runWithingsSync(
  userId: string
): Promise<WithingsSyncResult> {
  const connection = await db.query.connections.findFirst({
    where: and(
      eq(schema.connections.userId, userId),
      eq(schema.connections.provider, "withings")
    ),
  });
  if (!connection) throw new Error("No Withings connection for this user.");

  const end = new Date();
  const start = new Date();
  if (connection.lastSyncAt) {
    start.setTime(connection.lastSyncAt.getTime());
    start.setDate(start.getDate() - INCREMENTAL_OVERLAP_DAYS);
  } else {
    start.setDate(start.getDate() - BACKFILL_DAYS);
  }

  try {
    const accessToken = await getValidWithingsAccessToken(connection);
    const body = await fetchMeasures(
      accessToken,
      Math.floor(start.getTime() / 1000),
      Math.floor(end.getTime() / 1000)
    );
    const days = mapWithingsMeasures(body);
    for (const [date, patch] of days) {
      await applyWellnessPatch(userId, date, patch, "withings");
    }

    await db
      .update(schema.connections)
      .set({ lastSyncAt: end, status: "active", lastError: null })
      .where(eq(schema.connections.id, connection.id));

    const dates = [...days.keys()].sort();
    if (dates.length > 0) {
      const { computeDailyMetrics } = await import("@/lib/metrics");
      await computeDailyMetrics(userId, dates[0]);
    }

    logger.info("withings sync complete", {
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
    logger.error("withings sync failed", { userId, error: message });
    await db
      .update(schema.connections)
      .set({
        status:
          err instanceof WithingsError && err.code === "auth"
            ? "error"
            : connection.status,
        lastError: message,
      })
      .where(eq(schema.connections.id, connection.id));
    throw err;
  }
}
