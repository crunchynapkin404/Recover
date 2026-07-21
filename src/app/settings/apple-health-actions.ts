"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { requireUser } from "@/lib/session";
import { hashToken } from "@/lib/mcp/token-auth";
import { ingestAppleHealth } from "@/lib/sync/apple-health-ingest";
import { recordAuditEvent } from "@/lib/audit";

export interface ActionResult {
  ok: boolean;
  message: string;
}

function ingestUrl(token: string): string {
  const base = process.env.BETTER_AUTH_URL ?? "";
  return `${base}/api/connections/apple-health/ingest?token=${token}`;
}

/**
 * Enable (or regenerate) Apple Health ingest: mint a token, store its hash
 * for webhook lookup and the encrypted token for re-display, and return the
 * webhook URL to paste into Health Auto Export.
 */
export async function enableAppleHealth(): Promise<
  ActionResult & { url?: string }
> {
  const user = await requireUser();
  const token = randomBytes(24).toString("hex");

  await db
    .insert(schema.connections)
    .values({
      userId: user.id,
      provider: "apple_health",
      encryptedAccessToken: encrypt(token),
      externalAthleteId: hashToken(token),
      externalAthleteName: "Apple Health",
      status: "active",
    })
    .onConflictDoUpdate({
      target: [schema.connections.userId, schema.connections.provider],
      set: {
        encryptedAccessToken: encrypt(token),
        externalAthleteId: hashToken(token),
        status: "active",
        lastError: null,
      },
    });

  await recordAuditEvent({
    event: "connection_added",
    userId: user.id,
    metadata: { provider: "apple_health" },
  });

  revalidatePath("/settings");
  return {
    ok: true,
    message: "Apple Health enabled. Paste this URL into Health Auto Export.",
    url: ingestUrl(token),
  };
}

export async function disableAppleHealth(): Promise<ActionResult> {
  const user = await requireUser();
  await db
    .delete(schema.connections)
    .where(
      and(
        eq(schema.connections.userId, user.id),
        eq(schema.connections.provider, "apple_health")
      )
    );
  await recordAuditEvent({
    event: "connection_revoked",
    userId: user.id,
    metadata: { provider: "apple_health" },
  });
  revalidatePath("/settings");
  return { ok: true, message: "Apple Health disabled. Synced data is kept." };
}

/** One-off upload of a Health Auto Export JSON file from Settings. */
export async function uploadAppleHealthFile(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const user = await requireUser();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: "Choose a Health Auto Export JSON file." };
  }
  if (file.size > 25 * 1024 * 1024) {
    return { ok: false, message: "File too large (max 25 MB)." };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(await file.text());
  } catch {
    return { ok: false, message: "That file isn't valid JSON." };
  }

  try {
    const result = await ingestAppleHealth(user.id, payload ?? {});
    revalidatePath("/settings");
    revalidatePath("/");
    if (result.days === 0) {
      return {
        ok: false,
        message: "No recognized health metrics found in that file.",
      };
    }
    return {
      ok: true,
      message: `Imported ${result.days} day${result.days === 1 ? "" : "s"} from Apple Health.`,
    };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Import failed.",
    };
  }
}
