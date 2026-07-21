/**
 * Outbound webhooks — signed HTTP POSTs to a user-configured URL on key
 * events (readiness_computed, band_changed, backup_completed). Lets a
 * self-hoster wire Recover into Home Assistant, ntfy, or anything else
 * listening.
 *
 * Trust model: the target URL is chosen by the subscription's own owner —
 * an invited user, trusted the same as everywhere else in this app (v0.18
 * threat model: self-hosted, invite-only, ~10 friends, single owner, behind
 * a Cloudflare tunnel). No SSRF / private-IP blocking is applied here on
 * purpose — a self-hoster pointing this at a Home-Assistant instance on
 * their own LAN is the primary use case, not an attack to defend against.
 * This is a deliberate, documented trust-boundary decision, not an
 * oversight.
 */
import { createHmac } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { logger } from "@/lib/logger";

export type WebhookEvent =
  | "readiness_computed"
  | "band_changed"
  | "backup_completed";

/**
 * Narrow shape both global `fetch` and a test double satisfy — the test
 * suite's fake fetcher only ever returns `{ ok }`, never a full Response.
 */
export type WebhookFetcher = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string }
) => Promise<{ ok: boolean; status?: number }>;

export interface DispatchOptions {
  /** Defaults to global fetch; inject a fake for tests. */
  fetcher?: WebhookFetcher;
  /** Total attempts (first try + retries) before giving up. Default 4. */
  maxAttempts?: number;
}

const DEFAULT_MAX_ATTEMPTS = 4;
const BASE_BACKOFF_MS = 300;
const MAX_BACKOFF_MS = 4000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type SubscriptionRow = typeof schema.webhookSubscriptions.$inferSelect;

/**
 * Sign + POST to one subscription, retrying with capped exponential backoff
 * (300ms, 600ms, 1200ms, ... capped at 4s) up to maxAttempts, then record a
 * single delivery row with the cumulative outcome. Never throws — callers
 * (dispatchWebhook/broadcastWebhook) treat delivery as best-effort.
 */
async function deliverToSubscription(
  sub: SubscriptionRow,
  event: WebhookEvent,
  payload: Record<string, unknown>,
  opts: DispatchOptions
): Promise<void> {
  const fetcher: WebhookFetcher =
    opts.fetcher ?? ((url, init) => fetch(url, init));
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

  const body = JSON.stringify({
    event,
    payload,
    sentAt: new Date().toISOString(),
  });

  let secret: string;
  try {
    secret = decrypt(sub.encryptedSecret);
  } catch (err) {
    // Never log the ciphertext or any derived secret material.
    logger.error("webhook secret decrypt failed", {
      subscriptionId: sub.id,
      message: err instanceof Error ? err.message : String(err),
    });
    return;
  }
  const signature = createHmac("sha256", secret).update(body).digest("hex");

  let attempts = 0;
  let ok = false;
  let lastError: string | null = null;

  while (attempts < maxAttempts && !ok) {
    attempts++;
    try {
      const res = await fetcher(sub.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-recover-event": event,
          "x-recover-signature": signature,
        },
        body,
      });
      ok = !!res.ok;
      if (!ok) lastError = `HTTP ${res.status ?? "unknown"}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    if (!ok && attempts < maxAttempts) {
      const backoff = Math.min(
        BASE_BACKOFF_MS * 2 ** (attempts - 1),
        MAX_BACKOFF_MS
      );
      await sleep(backoff);
    }
  }

  await db.insert(schema.webhookDeliveries).values({
    subscriptionId: sub.id,
    event,
    status: ok ? "success" : "failed",
    attempts,
    lastError: ok ? null : lastError,
  });

  if (!ok) {
    logger.error("webhook delivery failed", {
      subscriptionId: sub.id,
      event,
      attempts,
    });
  }
}

/**
 * Dispatch `event` to every active subscription owned by `userId` that
 * lists it. The DB lookup is scoped by userId (not just by matching
 * event) — this function must never fire a subscription belonging to
 * another user.
 */
export async function dispatchWebhook(
  userId: string,
  event: WebhookEvent,
  payload: Record<string, unknown>,
  opts: DispatchOptions = {}
): Promise<void> {
  const subs = await db.query.webhookSubscriptions.findMany({
    where: and(
      eq(schema.webhookSubscriptions.userId, userId),
      eq(schema.webhookSubscriptions.active, true)
    ),
  });
  const matching = subs.filter((s) => (s.events ?? []).includes(event));

  for (const sub of matching) {
    try {
      await deliverToSubscription(sub, event, payload, opts);
    } catch (err) {
      logger.error("webhook dispatch threw", {
        subscriptionId: sub.id,
        event,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

/**
 * Dispatch an instance-wide event (currently only backup_completed) to
 * every active subscription that lists it, across all users. Unlike
 * dispatchWebhook this is deliberately not scoped to one userId — a
 * backup covers the whole self-hosted instance, not one user's private
 * data, and any trusted user may want to know it happened (symmetric with
 * how every other settings card in this app is self-service, not
 * owner-gated).
 */
export async function broadcastWebhook(
  event: "backup_completed",
  payload: Record<string, unknown>,
  opts: DispatchOptions = {}
): Promise<void> {
  const subs = await db.query.webhookSubscriptions.findMany({
    where: eq(schema.webhookSubscriptions.active, true),
  });
  const matching = subs.filter((s) => (s.events ?? []).includes(event));

  for (const sub of matching) {
    try {
      await deliverToSubscription(sub, event, payload, opts);
    } catch (err) {
      logger.error("webhook broadcast threw", {
        subscriptionId: sub.id,
        event,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
