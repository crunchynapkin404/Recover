"use server";

import { revalidatePath } from "next/cache";
import { db, schema } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { sendToUser } from "@/lib/push";

export async function setMorningPush(enabled: boolean): Promise<void> {
  const user = await requireUser();
  await db
    .insert(schema.notificationPrefs)
    .values({ userId: user.id, morningPushEnabled: enabled })
    .onConflictDoUpdate({
      target: schema.notificationPrefs.userId,
      set: { morningPushEnabled: enabled },
    });
  revalidatePath("/settings");
}

export async function sendTestNotification(): Promise<{
  ok: boolean;
  message: string;
}> {
  const user = await requireUser();
  const { sent, pruned } = await sendToUser(user.id, {
    title: "Recover test notification",
    body: "Push works — you'll get your readiness here every morning.",
    tag: "test",
    url: "/",
  });
  if (sent === 0)
    return {
      ok: false,
      message:
        pruned > 0
          ? "Subscription was stale and has been removed — re-enable notifications."
          : "No active subscription on this account yet.",
    };
  return {
    ok: true,
    message: `Sent to ${sent} device${sent === 1 ? "" : "s"}.`,
  };
}
