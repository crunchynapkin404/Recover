"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { applyAvailability } from "@/lib/week-plan/service";
import type { IntakeState } from "@/components/plan/intake-form";

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
