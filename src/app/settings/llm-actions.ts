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

  const model = String(formData.get("model") ?? "").trim();
  if (!model) {
    return { ok: false, message: "Model name is required." };
  }

  const apiKey = String(formData.get("apiKey") ?? "").trim();
  const baseUrl = String(formData.get("baseUrl") ?? "").trim() || null;

  // Anthropic requires an API key; Ollama/local may not
  if (providerType === "anthropic" && !apiKey) {
    return { ok: false, message: "Anthropic API key is required." };
  }

  const encryptedApiKey = apiKey ? encrypt(apiKey) : null;

  await db
    .insert(schema.llmSettings)
    .values({
      userId: user.id,
      providerType,
      model,
      encryptedApiKey,
      baseUrl,
    })
    .onConflictDoUpdate({
      target: schema.llmSettings.userId,
      set: {
        providerType,
        model,
        encryptedApiKey,
        baseUrl,
        updatedAt: new Date(),
      },
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
