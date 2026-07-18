import { db } from "@/lib/db";
import {
  mapAppleHealth,
  type HealthAutoExportPayload,
} from "@/lib/connectors/apple-health";
import { applyWellnessPatch } from "@/lib/wellness-merge";

export interface IngestResult {
  days: number;
  earliest: string | null;
}

/**
 * Map a Health Auto Export payload for one user and merge it into
 * wellness_daily through the per-field policy, then recompute daily
 * metrics from the earliest touched date. Shared by the webhook route and
 * the settings file upload.
 */
export async function ingestAppleHealth(
  userId: string,
  payload: HealthAutoExportPayload
): Promise<IngestResult> {
  const days = mapAppleHealth(payload);
  const dates = [...days.keys()].sort();
  for (const [date, patch] of days) {
    await applyWellnessPatch(userId, date, patch, "apple_health");
  }
  const earliest = dates[0] ?? null;
  if (earliest) {
    // Update lastSyncAt so the settings card can show freshness.
    const { schema } = await import("@/lib/db");
    const { and, eq } = await import("drizzle-orm");
    await db
      .update(schema.connections)
      .set({ lastSyncAt: new Date(), status: "active", lastError: null })
      .where(
        and(
          eq(schema.connections.userId, userId),
          eq(schema.connections.provider, "apple_health")
        )
      );
    const { computeDailyMetrics } = await import("@/lib/metrics");
    await computeDailyMetrics(userId, earliest);
  }
  return { days: days.size, earliest };
}
