"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { encrypt } from "@/lib/crypto";
import { recordAuditEvent } from "@/lib/audit";
import type { WebhookEvent } from "@/lib/webhooks/dispatch";

export interface WebhookActionResult {
  ok: boolean;
  message: string;
  /** Only set on creation — plaintext secret shown once, never stored. */
  secret?: string;
}

const VALID_EVENTS: WebhookEvent[] = [
  "readiness_computed",
  "band_changed",
  "backup_completed",
];

export async function createWebhookSubscription(
  _prev: WebhookActionResult | null,
  formData: FormData
): Promise<WebhookActionResult> {
  const user = await requireUser();

  const url = String(formData.get("url") ?? "").trim();
  if (!url) {
    return { ok: false, message: "URL is required." };
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { ok: false, message: "URL must be http:// or https://." };
    }
  } catch {
    return { ok: false, message: "That doesn't look like a valid URL." };
  }

  const events = formData
    .getAll("events")
    .map(String)
    .filter((e): e is WebhookEvent => (VALID_EVENTS as string[]).includes(e));
  if (events.length === 0) {
    return { ok: false, message: "Pick at least one event." };
  }

  // 32 random bytes (64 hex chars) — same generation convention as API
  // tokens (token-actions.ts). Stored encrypted (lib/crypto), shown to the
  // user once here; dispatchWebhook decrypts it only to compute the HMAC.
  const secret = randomBytes(32).toString("hex");

  const [created] = await db
    .insert(schema.webhookSubscriptions)
    .values({
      userId: user.id,
      url,
      encryptedSecret: encrypt(secret),
      events,
      active: true,
    })
    .returning();

  await recordAuditEvent({
    event: "webhook_created",
    userId: user.id,
    metadata: { subscriptionId: created.id, url, events },
  });

  revalidatePath("/settings");
  return {
    ok: true,
    message: "Webhook created. Copy the secret now — it won't be shown again.",
    secret,
  };
}

/** Revoke = deactivate (active=false), scoped to the caller's own row. */
export async function revokeWebhookSubscription(
  subscriptionId: string
): Promise<WebhookActionResult> {
  const user = await requireUser();

  const sub = await db.query.webhookSubscriptions.findFirst({
    where: and(
      eq(schema.webhookSubscriptions.id, subscriptionId),
      eq(schema.webhookSubscriptions.userId, user.id)
    ),
  });
  if (!sub) {
    return { ok: false, message: "Webhook not found." };
  }

  await db
    .update(schema.webhookSubscriptions)
    .set({ active: false })
    .where(eq(schema.webhookSubscriptions.id, subscriptionId));

  await recordAuditEvent({
    event: "webhook_revoked",
    userId: user.id,
    metadata: { subscriptionId: sub.id, url: sub.url },
  });

  revalidatePath("/settings");
  return { ok: true, message: "Webhook revoked." };
}
