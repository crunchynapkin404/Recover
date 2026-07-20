"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { runWithingsSync } from "@/lib/sync/withings-sync";
import { recordAuditEvent } from "@/lib/audit";

export interface ActionResult {
  ok: boolean;
  message: string;
}

export async function withingsSyncNow(): Promise<ActionResult> {
  const user = await requireUser();
  try {
    const result = await runWithingsSync(user.id);
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

export async function withingsDisconnect(): Promise<ActionResult> {
  const user = await requireUser();
  await db
    .delete(schema.connections)
    .where(
      and(
        eq(schema.connections.userId, user.id),
        eq(schema.connections.provider, "withings")
      )
    );
  await recordAuditEvent({
    event: "connection_revoked",
    userId: user.id,
    metadata: { provider: "withings" },
  });
  revalidatePath("/settings");
  return { ok: true, message: "Withings disconnected. Synced data is kept." };
}
