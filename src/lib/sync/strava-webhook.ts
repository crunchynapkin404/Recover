/**
 * Strava push subscription handling — reacts to a new ride the moment
 * Strava sees it, instead of waiting for the 15-min activity poll or the
 * daily sync. Strava's webhook payload carries no signature; the
 * subscription's verify_token (checked once, at the GET handshake below) is
 * the only proof of authenticity Strava offers, so owner_id is trusted only
 * insofar as it must match an existing active Strava connection before we
 * act on it.
 *
 * Recover stays intervals.icu-first for activity data (Strava rows are
 * excluded from AI/MCP surfaces — see connectors/strava.ts) — this module
 * only uses the webhook as a trigger to pull the ride from intervals.icu
 * sooner, never as the ride's source of truth.
 */
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { logger } from "@/lib/logger";
import { scheduleIntervalsSync } from "@/lib/sync/scheduler";

/** intervals.icu ingests from Strava on its own delayed cadence; give it a
 *  head start before we pull, or the sync will just miss the new ride. */
export const INTERVALS_CATCHUP_DELAY_S = 90;

export interface StravaWebhookEvent {
  aspect_type: "create" | "update" | "delete";
  object_type: "activity" | "athlete";
  object_id: number;
  owner_id: number;
  subscription_id: number;
  event_time: number;
  updates?: Record<string, unknown>;
}

export function isStravaWebhookEvent(
  body: unknown
): body is StravaWebhookEvent {
  if (!body || typeof body !== "object") return false;
  const b = body as Record<string, unknown>;
  return (
    (b.aspect_type === "create" ||
      b.aspect_type === "update" ||
      b.aspect_type === "delete") &&
    (b.object_type === "activity" || b.object_type === "athlete") &&
    typeof b.owner_id === "number"
  );
}

/**
 * GET handshake: Strava confirms ownership of the callback URL by sending
 * hub.challenge, which must be echoed back verbatim once hub.verify_token
 * matches the value given when the subscription was created.
 */
export function verifyChallenge(
  params: URLSearchParams,
  expectedToken: string
): { challenge: string } | null {
  if (params.get("hub.mode") !== "subscribe") return null;
  if (params.get("hub.verify_token") !== expectedToken) return null;
  const challenge = params.get("hub.challenge");
  if (!challenge) return null;
  return { challenge };
}

/**
 * Handle one webhook event: for a new/updated activity belonging to a known
 * athlete, schedule a catch-up intervals.icu sync. No-ops for unknown
 * athletes, deletes, and non-activity events (e.g. athlete deauthorization).
 */
export async function handleStravaWebhookEvent(
  event: StravaWebhookEvent
): Promise<{ scheduled: boolean }> {
  if (event.object_type !== "activity" || event.aspect_type === "delete") {
    return { scheduled: false };
  }

  const connection = await db.query.connections.findFirst({
    where: and(
      eq(schema.connections.provider, "strava"),
      eq(schema.connections.externalAthleteId, String(event.owner_id)),
      eq(schema.connections.status, "active")
    ),
    columns: { userId: true },
  });
  if (!connection) {
    logger.info("strava webhook: no matching active connection", {
      ownerId: event.owner_id,
    });
    return { scheduled: false };
  }

  const scheduled = await scheduleIntervalsSync(
    connection.userId,
    INTERVALS_CATCHUP_DELAY_S
  );
  if (scheduled) {
    logger.info("strava webhook: scheduled intervals catch-up sync", {
      userId: connection.userId,
      activityId: event.object_id,
      aspectType: event.aspect_type,
    });
  }
  return { scheduled };
}
