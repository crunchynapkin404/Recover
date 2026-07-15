"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { requireUser } from "@/lib/session";

export interface LlmActionResult {
  ok: boolean;
  message: string;
}

export async function saveLlmSettings(
  _prev: LlmActionResult | null,
  formData: FormData
): Promise<LlmActionResult> {
  const user = await requireUser();

  const providerType = formData.get("providerType") as string;
  if (providerType !== "anthropic" && providerType !== "openai_compatible") {
    return { ok: false, message: "Invalid provider type." };
  }

  const modelQuick = String(formData.get("modelQuick") ?? "").trim();
  const modelDeep = String(formData.get("modelDeep") ?? "").trim();
  const defaultMode =
    formData.get("defaultMode") === "quick"
      ? ("quick" as const)
      : ("deep" as const);
  if (!modelQuick || !modelDeep) {
    return { ok: false, message: "Both model fields are required." };
  }
  // Legacy column mirrors the deep slot (fallback for pre-v0.4 code paths).
  const model = modelDeep;

  const apiKey = String(formData.get("apiKey") ?? "").trim();
  const baseUrl = String(formData.get("baseUrl") ?? "").trim() || null;

  const existing = await db.query.llmSettings.findFirst({
    where: eq(schema.llmSettings.userId, user.id),
  });

  // Anthropic requires an API key; Ollama/local may not. A blank key on an
  // existing config means "keep the stored key" (matches the UI placeholder).
  if (providerType === "anthropic" && !apiKey && !existing?.encryptedApiKey) {
    return { ok: false, message: "Anthropic API key is required." };
  }

  const set: Partial<typeof schema.llmSettings.$inferInsert> = {
    providerType,
    model,
    modelQuick,
    modelDeep,
    defaultMode,
    baseUrl,
    updatedAt: new Date(),
  };
  if (apiKey) set.encryptedApiKey = encrypt(apiKey);

  await db
    .insert(schema.llmSettings)
    .values({
      userId: user.id,
      providerType,
      model,
      modelQuick,
      modelDeep,
      defaultMode,
      encryptedApiKey: apiKey ? encrypt(apiKey) : null,
      baseUrl,
    })
    .onConflictDoUpdate({
      target: schema.llmSettings.userId,
      set,
    });

  revalidatePath("/settings");
  return { ok: true, message: "AI coach settings saved." };
}

export async function deleteLlmSettings(): Promise<LlmActionResult> {
  const user = await requireUser();
  await db
    .delete(schema.llmSettings)
    .where(eq(schema.llmSettings.userId, user.id));
  revalidatePath("/settings");
  return { ok: true, message: "AI coach settings removed." };
}
