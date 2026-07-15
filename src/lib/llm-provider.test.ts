import { describe, it, expect, vi } from "vitest";

// Mock the db and crypto modules
vi.mock("@/lib/db", () => ({
  db: { query: { llmSettings: { findFirst: vi.fn() } } },
  schema: { llmSettings: { userId: "user_id" } },
}));
vi.mock("@/lib/crypto", () => ({
  decrypt: vi.fn((v: string) => `decrypted_${v}`),
}));
vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: vi.fn((opts) => {
    const provider = (model: string) => ({ model, ...opts });
    return provider;
  }),
}));
vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: vi.fn((opts) => {
    const provider = (model: string) => ({ model, ...opts });
    return provider;
  }),
}));

import { pickModel, resolveProvider } from "@/lib/llm-provider";
import { db } from "@/lib/db";

describe("pickModel", () => {
  const settings = {
    model: "legacy-model",
    modelQuick: "small-model",
    modelDeep: "big-model",
    defaultMode: "deep" as const,
  };

  it("uses the matching slot for an explicit mode", () => {
    expect(pickModel(settings, "quick")).toBe("small-model");
    expect(pickModel(settings, "deep")).toBe("big-model");
  });

  it("follows defaultMode when no mode is given", () => {
    expect(pickModel(settings)).toBe("big-model");
    expect(pickModel({ ...settings, defaultMode: "quick" })).toBe(
      "small-model"
    );
  });

  it("falls back to the legacy model when the slot is empty", () => {
    expect(pickModel({ ...settings, modelQuick: null }, "quick")).toBe(
      "legacy-model"
    );
    expect(pickModel({ ...settings, modelDeep: null }, "deep")).toBe(
      "legacy-model"
    );
  });
});

// v0.4a columns with pre-migration-like defaults for existing fixtures.
const baseSlots = {
  modelQuick: null,
  modelDeep: null,
  defaultMode: "deep" as const,
  coachPersonality: "encouraging" as const,
};

describe("resolveProvider", () => {
  it("returns null when no settings exist", async () => {
    vi.mocked(db.query.llmSettings.findFirst).mockResolvedValue(undefined);
    const result = await resolveProvider("user_123");
    expect(result).toBeNull();
  });

  it("resolves anthropic provider with decrypted key", async () => {
    vi.mocked(db.query.llmSettings.findFirst).mockResolvedValue({
      id: "s1",
      userId: "user_123",
      providerType: "anthropic",
      model: "claude-sonnet-4-20250514",
      encryptedApiKey: "enc_key_abc",
      baseUrl: null,
      updatedAt: new Date(),
      ...baseSlots,
    });

    const result = await resolveProvider("user_123");
    expect(result).not.toBeNull();
    expect(result!.providerType).toBe("anthropic");
    expect(result!.model).toBe("claude-sonnet-4-20250514");
  });

  it("resolves openai_compatible provider with baseUrl", async () => {
    vi.mocked(db.query.llmSettings.findFirst).mockResolvedValue({
      id: "s2",
      userId: "user_123",
      providerType: "openai_compatible",
      model: "llama3.1:8b",
      encryptedApiKey: null,
      baseUrl: "http://localhost:11434/v1",
      updatedAt: new Date(),
      ...baseSlots,
    });

    const result = await resolveProvider("user_123");
    expect(result).not.toBeNull();
    expect(result!.providerType).toBe("openai_compatible");
    expect(result!.model).toBe("llama3.1:8b");
  });

  it("returns null for anthropic without key", async () => {
    vi.mocked(db.query.llmSettings.findFirst).mockResolvedValue({
      id: "s3",
      userId: "user_123",
      providerType: "anthropic",
      model: "claude-sonnet-4-20250514",
      encryptedApiKey: null,
      baseUrl: null,
      updatedAt: new Date(),
      ...baseSlots,
    });

    const result = await resolveProvider("user_123");
    expect(result).toBeNull();
  });
});
