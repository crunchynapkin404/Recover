"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { runStravaSync } from "@/lib/sync/strava-sync";

export interface ActionResult {
  ok: boolean;
  message: string;
}

export async function stravaSyncNow(): Promise<ActionResult> {
  const user = await requireUser();
  try {
    const result = await runStravaSync(user.id);
    revalidatePath("/settings");
    revalidatePath("/log");
    return {
      ok: true,
      message: `Synced ${result.activities} activities (since ${result.windowStart}).`,
    };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Sync failed.",
    };
  }
}

export async function stravaDisconnect(): Promise<ActionResult> {
  const user = await requireUser();
  await db
    .delete(schema.connections)
    .where(
      and(
        eq(schema.connections.userId, user.id),
        eq(schema.connections.provider, "strava")
      )
    );
  revalidatePath("/settings");
  return { ok: true, message: "Strava disconnected. Synced data is kept." };
}

export async function setAutoDescribeStrava(enabled: boolean): Promise<void> {
  const user = await requireUser();
  await db
    .insert(schema.notificationPrefs)
    .values({ userId: user.id, autoDescribeStrava: enabled })
    .onConflictDoUpdate({
      target: schema.notificationPrefs.userId,
      set: { autoDescribeStrava: enabled },
    });
  revalidatePath("/settings");
}
