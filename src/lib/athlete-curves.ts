/**
 * Athlete curves cache (v0.4c) — precomputed power/pace curves and best
 * efforts fetched from intervals.icu, cached in `athlete_curves` with a 6 h
 * TTL. Stale-if-error: a failed refresh serves the cached copy with
 * `stale: true` instead of erroring. Manual/Strava-only users get
 * `{ available: false, reason: "no_connection" }` (provenance rules).
 */
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { logger } from "@/lib/logger";
import {
  fetchAthletePowerCurves,
  fetchAthletePaceCurves,
  fetchBestEfforts,
  type IntervalsPowerCurve,
  type IntervalsPaceCurve,
  type IntervalsBestEffort,
} from "@/lib/connectors/intervals";

export const CURVES_TTL_MS = 6 * 60 * 60 * 1000;

export type CurveDays = 30 | 90 | 365;

export interface CurveFetchers {
  power?: typeof fetchAthletePowerCurves;
  pace?: typeof fetchAthletePaceCurves;
  bestEfforts?: typeof fetchBestEfforts;
}

export type CurvesResult<T> =
  | { available: true; stale: boolean; fetchedAt: string; data: T }
  | { available: false; reason: "no_connection" | "fetch_failed" };

type CacheKind = "power" | "pace" | "best_efforts";

async function cachedFetch<T>(
  userId: string,
  kind: CacheKind,
  days: CurveDays,
  now: Date,
  fetcher: (p: {
    apiKey: string;
    athleteId: string;
    days: number;
  }) => Promise<T>
): Promise<CurvesResult<T>> {
  const connection = await db.query.connections.findFirst({
    where: and(
      eq(schema.connections.userId, userId),
      eq(schema.connections.provider, "intervals_icu"),
      eq(schema.connections.status, "active")
    ),
  });
  if (!connection) return { available: false, reason: "no_connection" };

  const params = `days=${days}`;
  const cached = await db.query.athleteCurves.findFirst({
    where: and(
      eq(schema.athleteCurves.userId, userId),
      eq(schema.athleteCurves.kind, kind),
      eq(schema.athleteCurves.params, params)
    ),
  });
  if (cached && now.getTime() - cached.fetchedAt.getTime() < CURVES_TTL_MS) {
    return {
      available: true,
      stale: false,
      fetchedAt: cached.fetchedAt.toISOString(),
      data: cached.data as T,
    };
  }

  try {
    const data = await fetcher({
      apiKey: decrypt(connection.encryptedAccessToken),
      athleteId: connection.externalAthleteId,
      days,
    });
    await db
      .insert(schema.athleteCurves)
      .values({ userId, kind, params, data, fetchedAt: now })
      .onConflictDoUpdate({
        target: [
          schema.athleteCurves.userId,
          schema.athleteCurves.kind,
          schema.athleteCurves.params,
        ],
        set: { data, fetchedAt: now },
      });
    return {
      available: true,
      stale: false,
      fetchedAt: now.toISOString(),
      data,
    };
  } catch (err) {
    logger.warn("athlete curves fetch failed", {
      userId,
      kind,
      message: err instanceof Error ? err.message : String(err),
    });
    if (cached) {
      return {
        available: true,
        stale: true,
        fetchedAt: cached.fetchedAt.toISOString(),
        data: cached.data as T,
      };
    }
    return { available: false, reason: "fetch_failed" };
  }
}

export async function getCurves(
  userId: string,
  kind: "power" | "pace",
  opts?: { days?: CurveDays; now?: Date; fetchers?: CurveFetchers }
): Promise<CurvesResult<IntervalsPowerCurve | IntervalsPaceCurve>> {
  const days = opts?.days ?? 90;
  const now = opts?.now ?? new Date();
  return kind === "power"
    ? cachedFetch(
        userId,
        "power",
        days,
        now,
        opts?.fetchers?.power ?? fetchAthletePowerCurves
      )
    : cachedFetch(
        userId,
        "pace",
        days,
        now,
        opts?.fetchers?.pace ?? fetchAthletePaceCurves
      );
}

export async function getBestEffortsCached(
  userId: string,
  opts?: { days?: CurveDays; now?: Date; fetchers?: CurveFetchers }
): Promise<CurvesResult<IntervalsBestEffort[]>> {
  const days = opts?.days ?? 90;
  const now = opts?.now ?? new Date();
  return cachedFetch(
    userId,
    "best_efforts",
    days,
    now,
    opts?.fetchers?.bestEfforts ?? fetchBestEfforts
  );
}
