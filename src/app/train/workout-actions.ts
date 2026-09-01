"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { exportWorkoutToIcu } from "@/lib/week-plan/export-workout";

export interface ExportActionResult {
  ok: boolean;
  message: string;
}

/** `YYYY-MM-DD`, and nothing else — the date is a lookup key, not free text. */
const YMD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Send the open week's session for `date` to intervals.icu, and pin it.
 *
 * The clock is read HERE and passed down, so exportWorkoutToIcu stays testable
 * without one — the same reason src/lib/interval/ has no Date in it anywhere.
 */
export async function exportWorkoutAction(
  _prev: ExportActionResult | null,
  formData: FormData
): Promise<ExportActionResult> {
  const user = await requireUser();
  const date = String(formData.get("date") ?? "");
  const idx = Number(formData.get("i") ?? "0");
  if (!YMD.test(date) || !Number.isInteger(idx) || idx < 0) {
    return { ok: false, message: "That session could not be identified." };
  }

  const res = await exportWorkoutToIcu(db, user.id, date, idx, new Date());
  if (!res.ok) return { ok: false, message: res.message };

  revalidatePath("/train");
  return { ok: true, message: `${res.workoutName} sent to intervals.icu.` };
}
