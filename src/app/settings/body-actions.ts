"use server";

import { revalidatePath } from "next/cache";
import { db, schema } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { computeDailyMetrics } from "@/lib/metrics";

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const MIN_NEED_SECS = 4 * 3600;
const MAX_NEED_SECS = 12 * 3600;
// v0.10 Honest Load: athlete thresholds for the native load engine.
const MIN_MAX_HR = 100;
const MAX_MAX_HR = 230;
const MIN_FTP = 50;
const MAX_FTP = 600;
/** Threshold changes re-shape computed load this far back. */
const RECOMPUTE_WINDOW_DAYS = 90;

export async function setBodyPrefs(input: {
  wakeTime: string | null;
  sleepNeedSecs: number;
  maxHr: number | null;
  ftpWatts: number | null;
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
  if (
    input.maxHr != null &&
    (!Number.isInteger(input.maxHr) ||
      input.maxHr < MIN_MAX_HR ||
      input.maxHr > MAX_MAX_HR)
  ) {
    return { ok: false, message: "Max HR must be between 100 and 230 bpm." };
  }
  if (
    input.ftpWatts != null &&
    (!Number.isInteger(input.ftpWatts) ||
      input.ftpWatts < MIN_FTP ||
      input.ftpWatts > MAX_FTP)
  ) {
    return { ok: false, message: "FTP must be between 50 and 600 watts." };
  }

  const before = await db.query.bodyPrefs.findFirst({
    where: (t, { eq }) => eq(t.userId, user.id),
  });

  const values = {
    wakeTime,
    sleepNeedSecs: input.sleepNeedSecs,
    maxHr: input.maxHr,
    ftpWatts: input.ftpWatts,
  };
  await db
    .insert(schema.bodyPrefs)
    .values({ userId: user.id, ...values })
    .onConflictDoUpdate({
      target: schema.bodyPrefs.userId,
      set: values,
    });

  // New thresholds change the native load engine's per-activity numbers —
  // recompute the recent window so ctl/atl pick them up.
  if (
    (before?.maxHr ?? null) !== input.maxHr ||
    (before?.ftpWatts ?? null) !== input.ftpWatts
  ) {
    const since = new Date();
    since.setDate(since.getDate() - RECOMPUTE_WINDOW_DAYS);
    await computeDailyMetrics(user.id, since.toISOString().slice(0, 10));
  }

  revalidatePath("/settings");
  revalidatePath("/");
  return { ok: true };
}
