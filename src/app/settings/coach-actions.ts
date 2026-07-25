"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { deleteMemory, updateMemory } from "@/lib/coach-memory";
import { SUPPORTED_COACH_LANGUAGES } from "@/lib/coach-persona";
import type { LlmActionResult } from "./llm-actions";

export async function saveCoachSettings(
  _prev: LlmActionResult | null,
  formData: FormData
): Promise<LlmActionResult> {
  const user = await requireUser();
  const personality = formData.get("personality");
  if (
    personality !== "analytical" &&
    personality !== "encouraging" &&
    personality !== "direct"
  ) {
    return { ok: false, message: "Invalid personality." };
  }
  const language = String(formData.get("language") ?? "auto");
  if (!SUPPORTED_COACH_LANGUAGES.some((l) => l.code === language)) {
    return { ok: false, message: "Invalid language." };
  }
  const rows = await db
    .update(schema.llmSettings)
    .set({
      coachPersonality: personality,
      coachLanguage: language,
      updatedAt: new Date(),
    })
    .where(eq(schema.llmSettings.userId, user.id))
    .returning();
  if (rows.length === 0) {
    return { ok: false, message: "Configure the AI coach first." };
  }
  revalidatePath("/settings");
  return { ok: true, message: "Coach settings saved." };
}

export async function updateMemoryAction(
  id: string,
  content: string
): Promise<LlmActionResult> {
  const user = await requireUser();
  const ok = await updateMemory(user.id, id, content);
  if (ok) revalidatePath("/settings");
  return ok
    ? { ok: true, message: "Memory updated." }
    : { ok: false, message: "Could not update memory (max 280 chars)." };
}

export async function deleteMemoryAction(id: string): Promise<LlmActionResult> {
  const user = await requireUser();
  const ok = await deleteMemory(user.id, id);
  if (ok) revalidatePath("/settings");
  return ok
    ? { ok: true, message: "Memory deleted." }
    : { ok: false, message: "Memory not found." };
}
