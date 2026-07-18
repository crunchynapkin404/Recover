"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { requireUser } from "@/lib/session";
import { OuraError, validateToken } from "@/lib/connectors/oura";
import { runOuraSync } from "@/lib/sync/oura-sync";

export interface ActionResult {
  ok: boolean;
  message: string;
}

export async function connectOura(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const user = await requireUser();
  const token = String(formData.get("token") ?? "").trim();
  if (!token) {
    return { ok: false, message: "Paste your Oura personal access token." };
  }

  let identity;
  try {
    identity = await validateToken(token);
  } catch (err) {
    if (err instanceof OuraError && err.code === "auth") {
      return { ok: false, message: "Oura rejected that token." };
    }
    return { ok: false, message: "Could not reach Oura. Try again." };
  }

  await db
    .insert(schema.connections)
    .values({
      userId: user.id,
      provider: "oura",
      encryptedAccessToken: encrypt(token),
      externalAthleteId: identity.id,
      externalAthleteName: identity.email,
      status: "active",
    })
    .onConflictDoUpdate({
      target: [schema.connections.userId, schema.connections.provider],
      set: {
        encryptedAccessToken: encrypt(token),
        externalAthleteId: identity.id,
        externalAthleteName: identity.email,
        status: "active",
        lastError: null,
        lastSyncAt: null, // fresh backfill window
      },
    });

  try {
    const result = await runOuraSync(user.id);
    revalidatePath("/");
    revalidatePath("/settings");
    return {
      ok: true,
      message: `Connected. Synced ${result.wellnessDays} days of sleep & readiness.`,
    };
  } catch {
    return {
      ok: true,
      message: `Connected, but the first sync failed — use "Sync" to retry.`,
    };
  }
}

export async function ouraSyncNow(): Promise<ActionResult> {
  const user = await requireUser();
  try {
    const result = await runOuraSync(user.id);
    revalidatePath("/settings");
    revalidatePath("/");
    return {
      ok: true,
      message: `Synced ${result.wellnessDays} days (since ${result.windowStart}).`,
    };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Sync failed.",
    };
  }
}

export async function ouraDisconnect(): Promise<ActionResult> {
  const user = await requireUser();
  await db
    .delete(schema.connections)
    .where(
      and(
        eq(schema.connections.userId, user.id),
        eq(schema.connections.provider, "oura")
      )
    );
  revalidatePath("/settings");
  return { ok: true, message: "Oura disconnected. Synced data is kept." };
}
