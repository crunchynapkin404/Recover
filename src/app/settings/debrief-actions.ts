"use server";

import { revalidatePath } from "next/cache";
import { db, schema } from "@/lib/db";
import { requireUser } from "@/lib/session";

export async function setRideDebriefs(enabled: boolean): Promise<void> {
  const user = await requireUser();
  await db
    .insert(schema.notificationPrefs)
    .values({ userId: user.id, rideDebriefsEnabled: enabled })
    .onConflictDoUpdate({
      target: schema.notificationPrefs.userId,
      set: { rideDebriefsEnabled: enabled },
    });
  revalidatePath("/settings");
}

export async function setDebriefPush(enabled: boolean): Promise<void> {
  const user = await requireUser();
  await db
    .insert(schema.notificationPrefs)
    .values({ userId: user.id, debriefPushEnabled: enabled })
    .onConflictDoUpdate({
      target: schema.notificationPrefs.userId,
      set: { debriefPushEnabled: enabled },
    });
  revalidatePath("/settings");
}
