"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { addChosenWorkout, removeChosenWorkout } from "@/lib/week-plan/service";

export interface PickActionResult {
  ok: boolean;
  message: string;
}

/** `YYYY-MM-DD`, and nothing else — the date is a lookup key, not free text. */
const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** One sentence per refusal, in the athlete's terms rather than the code's. */
const REFUSALS: Record<string, string> = {
  day_settled: "That day is already done — pick another.",
  day_full: "That day already has two sessions.",
  past_day: "That day has passed.",
  no_open_week: "There is no open week to add to yet.",
  invalid: "That workout could not be added.",
};

/**
 * Put a workout the athlete picked from the library onto a day.
 *
 * `today` comes from the browser: the athlete's local calendar day is a
 * client fact, and the server's date would refuse a legitimate evening add
 * for anyone west of UTC. It is shape-checked here and the eligibility rules
 * are re-run server-side inside addChosenWorkout regardless.
 */
export async function pickWorkoutAction(
  _prev: PickActionResult | null,
  formData: FormData
): Promise<PickActionResult> {
  const user = await requireUser();
  const date = String(formData.get("date") ?? "");
  const today = String(formData.get("today") ?? "");
  const workoutId = String(formData.get("workoutId") ?? "");
  const durationMins = Number(formData.get("durationMins") ?? "0");

  if (!YMD.test(date) || !YMD.test(today) || !workoutId) {
    return { ok: false, message: "That workout could not be identified." };
  }
  if (!Number.isInteger(durationMins) || durationMins <= 0) {
    return { ok: false, message: "That length is not a number of minutes." };
  }

  const outcome = await addChosenWorkout(
    user.id,
    date,
    workoutId,
    durationMins,
    today
  );
  if (outcome !== "added") {
    return { ok: false, message: REFUSALS[outcome] ?? REFUSALS.invalid };
  }

  revalidatePath("/train");
  revalidatePath("/");
  return { ok: true, message: "Added to your week." };
}

/** Take an athlete-chosen session back off a day. */
export async function unpickWorkoutAction(
  _prev: PickActionResult | null,
  formData: FormData
): Promise<PickActionResult> {
  const user = await requireUser();
  const date = String(formData.get("date") ?? "");
  const workoutId = String(formData.get("workoutId") ?? "");
  if (!YMD.test(date) || !workoutId) {
    return { ok: false, message: "That session could not be identified." };
  }

  const outcome = await removeChosenWorkout(user.id, date, workoutId);
  if (outcome !== "removed") {
    return { ok: false, message: REFUSALS[outcome] ?? REFUSALS.invalid };
  }

  revalidatePath("/train");
  revalidatePath("/");
  return { ok: true, message: "Removed." };
}
