import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { computeDailyMetrics } from "@/lib/metrics";

export interface ActivityWriteInput {
  sport: string;
  name?: string;
  startDate: string; // YYYY-MM-DD
  durationMinutes?: number;
  distanceKm?: number;
  load?: number;
  avgHr?: number;
  avgPower?: number;
  elevationM?: number;
}

/**
 * Insert a manual activity and recompute daily metrics from its date (the
 * native load engine feeds ctl/atl from activities — v0.10). Bulk callers
 * (CSV import) pass `recompute: false` and run one recompute at the end.
 */
export async function createManualActivity(
  userId: string,
  input: ActivityWriteInput,
  opts?: { recompute?: boolean }
): Promise<{ activityId: string }> {
  const externalId = `manual-${Date.now()}`;
  const [row] = await db
    .insert(schema.activities)
    .values({
      userId,
      provider: "manual",
      externalId,
      sport: input.sport,
      name: input.name || `${input.sport} session`,
      startDate: new Date(input.startDate),
      durationS:
        input.durationMinutes != null
          ? Math.round(input.durationMinutes * 60)
          : null,
      distanceM:
        input.distanceKm != null ? Math.round(input.distanceKm * 1000) : null,
      load: input.load ?? null,
      avgHr: input.avgHr ?? null,
      avgPower: input.avgPower ?? null,
      elevationM: input.elevationM ?? null,
    })
    .returning();
  if (opts?.recompute !== false) {
    await computeDailyMetrics(userId, input.startDate);
  }
  // v0.15: a manual ride enters the debrief loop like a synced one.
  try {
    const { runDebriefLifecycle } = await import("@/lib/debrief/lifecycle");
    await runDebriefLifecycle(userId);
  } catch {
    // best-effort; the log entry comes from inside the lifecycle
  }
  return { activityId: row.id };
}

/**
 * Manual delete fallback for activities a sync can never detect as removed
 * upstream — most notably intervals.icu, which has no webhooks (the Strava
 * webhook's own delete event is handled automatically, see
 * strava-webhook.ts). Scoped by userId in the query itself, not just the
 * caller's own check.
 */
export async function deleteActivity(
  userId: string,
  activityId: string
): Promise<boolean> {
  const removed = await db
    .delete(schema.activities)
    .where(
      and(eq(schema.activities.id, activityId), eq(schema.activities.userId, userId))
    )
    .returning();
  return removed.length > 0;
}
