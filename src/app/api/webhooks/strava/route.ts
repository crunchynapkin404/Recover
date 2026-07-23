/**
 * GET/POST /api/webhooks/strava — Strava push subscription callback.
 *
 * One-time setup (Strava allows exactly one subscription per API client,
 * shared across every athlete who has authorized the app):
 *
 *   curl -X POST https://www.strava.com/api/v3/push_subscriptions \
 *     -F client_id=$STRAVA_CLIENT_ID \
 *     -F client_secret=$STRAVA_CLIENT_SECRET \
 *     -F callback_url=https://<your-public-host>/api/webhooks/strava \
 *     -F verify_token=$STRAVA_WEBHOOK_VERIFY_TOKEN
 *
 * Strava GETs the callback_url once to confirm ownership (the hub.challenge
 * handshake below) before the subscription is actually created.
 */
import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import {
  handleStravaWebhookEvent,
  isStravaWebhookEvent,
  verifyChallenge,
} from "@/lib/sync/strava-webhook";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const token = process.env.STRAVA_WEBHOOK_VERIFY_TOKEN;
  if (!token) {
    logger.error("strava webhook: STRAVA_WEBHOOK_VERIFY_TOKEN not configured");
    return NextResponse.json({ error: "not configured" }, { status: 503 });
  }

  const result = verifyChallenge(new URL(req.url).searchParams, token);
  if (!result) {
    return NextResponse.json(
      { error: "invalid verification request" },
      { status: 403 }
    );
  }
  return NextResponse.json({ "hub.challenge": result.challenge });
}

// Strava disables a subscription after repeated non-200 responses, so every
// POST path below acks 200 regardless of outcome — failures are logged, not
// surfaced to Strava, since a retry can't fix a malformed body or an
// unrecognized athlete anyway.
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    logger.error("strava webhook: unparsable body");
    return NextResponse.json({ ok: true });
  }

  if (!isStravaWebhookEvent(body)) {
    logger.error("strava webhook: unexpected payload shape");
    return NextResponse.json({ ok: true });
  }

  try {
    await handleStravaWebhookEvent(body);
  } catch (err) {
    logger.error("strava webhook: handling failed", {
      message: err instanceof Error ? err.message : String(err),
    });
  }
  return NextResponse.json({ ok: true });
}
