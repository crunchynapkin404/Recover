"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
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

/**
 * Queue a full wellness history backfill (v0.36).
 *
 * Enqueues and returns — the job runs for minutes and a server action cannot.
 * The scheduler tick picks it up and routes it on `kind`.
 */
export async function backfillHistory(): Promise<ActionResult> {
  const user = await requireUser();

  const connection = await db.query.connections.findFirst({
    where: and(
      eq(schema.connections.userId, user.id),
      eq(schema.connections.provider, "intervals_icu")
    ),
    columns: { id: true },
  });
  if (!connection) {
    return { ok: false, message: "Connect intervals.icu first." };
  }

  const existing = await db.query.syncJobs.findFirst({
    where: and(
      eq(schema.syncJobs.userId, user.id),
      eq(schema.syncJobs.provider, "intervals_icu"),
      eq(schema.syncJobs.kind, "backfill"),
      inArray(schema.syncJobs.status, ["pending", "running"])
    ),
    columns: { id: true },
  });
  if (existing) {
    return { ok: false, message: "A backfill is already queued or running." };
  }

  await db.insert(schema.syncJobs).values({
    userId: user.id,
    provider: "intervals_icu",
    kind: "backfill",
    runAfter: new Date(),
  });

  revalidatePath("/settings");
  return {
    ok: true,
    message:
      "Backfill queued. It runs in the background and can take several minutes.",
  };
}

/**
 * How often to re-pull intervals.icu wellness, in minutes. 0 = daily sync
 * only. Validated against the offered choices rather than accepting any
 * number — a stray value would either hammer a free service or silently
 * disable the poll.
 */
export async function setWellnessPollInterval(
  minutes: number
): Promise<ActionResult> {
  const user = await requireUser();
  const { WELLNESS_POLL_INTERVAL_CHOICES } =
    await import("@/lib/sync/wellness-refresh");
  if (
    !(WELLNESS_POLL_INTERVAL_CHOICES as readonly number[]).includes(minutes)
  ) {
    return { ok: false, message: "Unsupported sync interval." };
  }

  const updated = await db
    .update(schema.connections)
    .set({ wellnessPollIntervalMin: minutes })
    .where(
      and(
        eq(schema.connections.userId, user.id),
        eq(schema.connections.provider, "intervals_icu")
      )
    )
    .returning();

  if (updated.length === 0) {
    return { ok: false, message: "No intervals.icu connection to configure." };
  }

  revalidatePath("/settings");
  return {
    ok: true,
    message:
      minutes === 0
        ? "Wellness will sync once a day."
        : `Wellness will sync every ${minutes} minutes.`,
  };
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
