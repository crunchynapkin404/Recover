/**
 * LLM provider resolution — resolves the user's LLM settings into an AI SDK
 * provider instance. Supports Anthropic (direct) and any OpenAI-compatible
 * endpoint (including local Ollama).
 */

import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { decrypt } from "@/lib/crypto";

export interface ResolvedProvider {
  provider:
    ReturnType<typeof createAnthropic> | ReturnType<typeof createOpenAI>;
  model: string;
  providerType: "anthropic" | "openai_compatible";
}

/**
 * Resolve the user's LLM settings into a provider + model.
 * Returns null if the user has no LLM settings configured.
 * Decrypts the API key per request (never cached, never logged).
 */
export async function resolveProvider(
  userId: string
): Promise<ResolvedProvider | null> {
  const settings = await db.query.llmSettings.findFirst({
    where: eq(schema.llmSettings.userId, userId),
  });

  if (!settings) return null;

  const apiKey = settings.encryptedApiKey
    ? decrypt(settings.encryptedApiKey)
    : undefined;

  if (settings.providerType === "anthropic") {
    if (!apiKey) return null;
    const provider = createAnthropic({ apiKey });
    return { provider, model: settings.model, providerType: "anthropic" };
  }

  // openai_compatible — works with Ollama, Together, local LLMs, etc.
  let baseURL = settings.baseUrl ?? "http://localhost:11434/v1";
  // Ensure /v1 suffix for OpenAI-compatible endpoints (Ollama, etc.)
  if (!baseURL.endsWith("/v1") && !baseURL.endsWith("/v1/")) {
    baseURL = baseURL.replace(/\/$/, "") + "/v1";
  }
  const provider = createOpenAI({
    apiKey: apiKey ?? "ollama", // Ollama doesn't need a real key
    baseURL,
  });
  return { provider, model: settings.model, providerType: "openai_compatible" };
}
