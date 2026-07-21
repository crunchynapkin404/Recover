"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { requireUser } from "@/lib/session";
import { ConnectorError, validateKey } from "@/lib/connectors/intervals";
import { runIntervalsSync } from "@/lib/sync/intervals-sync";
import { recordAuditEvent } from "@/lib/audit";

export interface ActionResult {
  ok: boolean;
  message: string;
}

export async function connectIntervals(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const user = await requireUser();
  const apiKey = String(formData.get("apiKey") ?? "").trim();
  if (!apiKey) {
    return { ok: false, message: "Paste your intervals.icu API key first." };
  }

  let athlete;
  try {
    athlete = await validateKey(apiKey);
  } catch (err) {
    if (err instanceof ConnectorError && err.code === "auth_expired") {
      return { ok: false, message: "intervals.icu rejected that API key." };
    }
    return { ok: false, message: "Could not reach intervals.icu. Try again." };
  }

  await db
    .insert(schema.connections)
    .values({
      userId: user.id,
      provider: "intervals_icu",
      encryptedAccessToken: encrypt(apiKey),
      externalAthleteId: athlete.id,
      externalAthleteName: athlete.name,
      status: "active",
    })
    .onConflictDoUpdate({
      target: [schema.connections.userId, schema.connections.provider],
      set: {
        encryptedAccessToken: encrypt(apiKey),
        externalAthleteId: athlete.id,
        externalAthleteName: athlete.name,
        status: "active",
        lastError: null,
        lastSyncAt: null, // force a fresh backfill window
      },
    });

  await recordAuditEvent({
    event: "connection_added",
    userId: user.id,
    metadata: { provider: "intervals_icu" },
  });

  try {
    const result = await runIntervalsSync(user.id);
    revalidatePath("/");
    revalidatePath("/settings");
    return {
      ok: true,
      message: `Connected as ${athlete.name ?? athlete.id}. Synced ${result.wellnessDays} wellness days and ${result.activities} activities.`,
    };
  } catch {
    return {
      ok: true,
      message: `Connected as ${athlete.name ?? athlete.id}, but the first sync failed — use "Sync now" to retry.`,
    };
  }
}

export async function syncNow(): Promise<ActionResult> {
  const user = await requireUser();
  try {
    const result = await runIntervalsSync(user.id);
    revalidatePath("/");
    revalidatePath("/settings");
    return {
      ok: true,
      message: `Synced ${result.wellnessDays} wellness days and ${result.activities} activities (${result.windowStart} → ${result.windowEnd}).`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sync failed.";
    return { ok: false, message };
  }
}

export async function disconnectIntervals(): Promise<ActionResult> {
  const user = await requireUser();
  await db
    .delete(schema.connections)
    .where(
      and(
        eq(schema.connections.userId, user.id),
        eq(schema.connections.provider, "intervals_icu")
      )
    );
  await recordAuditEvent({
    event: "connection_revoked",
    userId: user.id,
    metadata: { provider: "intervals_icu" },
  });
  revalidatePath("/settings");
  return {
    ok: true,
    message: "intervals.icu disconnected. Synced data is kept.",
  };
}
