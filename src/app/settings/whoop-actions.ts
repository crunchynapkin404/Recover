"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { runWhoopSync } from "@/lib/sync/whoop-sync";

export interface ActionResult {
  ok: boolean;
  message: string;
}

export async function whoopSyncNow(): Promise<ActionResult> {
  const user = await requireUser();
  try {
    const result = await runWhoopSync(user.id);
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

export async function whoopDisconnect(): Promise<ActionResult> {
  const user = await requireUser();
  await db
    .delete(schema.connections)
    .where(
      and(
        eq(schema.connections.userId, user.id),
        eq(schema.connections.provider, "whoop")
      )
    );
  revalidatePath("/settings");
  return { ok: true, message: "Whoop disconnected. Synced data is kept." };
}
