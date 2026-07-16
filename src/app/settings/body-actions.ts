"use server";

import { revalidatePath } from "next/cache";
import { db, schema } from "@/lib/db";
import { requireUser } from "@/lib/session";

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const MIN_NEED_SECS = 4 * 3600;
const MAX_NEED_SECS = 12 * 3600;

export async function setBodyPrefs(input: {
  wakeTime: string | null;
  sleepNeedSecs: number;
}): Promise<{ ok: boolean; message?: string }> {
  const user = await requireUser();

  // Empty string means "cleared", not "00:00" — clearing must be possible.
  const wakeTime = input.wakeTime?.trim() ? input.wakeTime.trim() : null;
  if (wakeTime != null && !HHMM.test(wakeTime)) {
    return { ok: false, message: "Wake time must look like 07:00." };
  }
  if (
    !Number.isFinite(input.sleepNeedSecs) ||
    input.sleepNeedSecs < MIN_NEED_SECS ||
    input.sleepNeedSecs > MAX_NEED_SECS
  ) {
    return {
      ok: false,
      message: "Sleep target must be between 4 and 12 hours.",
    };
  }

  await db
    .insert(schema.bodyPrefs)
    .values({ userId: user.id, wakeTime, sleepNeedSecs: input.sleepNeedSecs })
    .onConflictDoUpdate({
      target: schema.bodyPrefs.userId,
      set: { wakeTime, sleepNeedSecs: input.sleepNeedSecs },
    });

  revalidatePath("/settings");
  revalidatePath("/");
  return { ok: true };
}
