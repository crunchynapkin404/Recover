"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { applyAvailability, rolloverWeekPlan } from "@/lib/week-plan/service";
import type { IntakeState } from "@/components/plan/intake-form";

/**
 * v0.9.3 "Plan this week": materialize the current week on demand — for
 * plans created mid-week (or before this patch) that would otherwise wait
 * for the next weekly review. Safe to press twice: the rollover is
 * idempotent per user-week.
 */
export async function startWeek(): Promise<void> {
  const user = await requireUser();
  await rolloverWeekPlan(user.id);
  revalidatePath("/plan");
  revalidatePath("/");
}

export async function submitAvailability(
  _prev: IntakeState,
  formData: FormData
): Promise<IntakeState> {
  const user = await requireUser();

  const mins: number[] = [];
  for (let i = 0; i < 7; i++) {
    const raw = Number(formData.get(`mins-${i}`));
    mins.push(
      Number.isFinite(raw) ? Math.max(0, Math.min(720, Math.round(raw))) : 0
    );
  }

  const result = await applyAvailability(user.id, mins);
  revalidatePath("/plan");
  revalidatePath("/");
  return {
    message:
      result === "applied"
        ? "Week updated around your availability."
        : "No open week to update yet.",
  };
}
