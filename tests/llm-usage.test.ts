import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

const USER = "test-llm-usage-user";

async function cleanup() {
  const { db, schema } = await import("@/lib/db");
  await db.delete(schema.llmUsage).where(eq(schema.llmUsage.userId, USER));
  await db.delete(schema.users).where(eq(schema.users.id, USER));
}

describe.skipIf(!hasDb)("llm usage recording", () => {
  beforeAll(async () => {
    await cleanup();
    const { db, schema } = await import("@/lib/db");
    await db.insert(schema.users).values({
      id: USER,
      name: "Usage",
      email: "llm-usage@example.invalid",
    });
  });

  afterAll(cleanup);

  it("records a row and aggregates it by model+purpose", async () => {
    const { recordLlmUsage, getUsageSummary } = await import("@/lib/llm-usage");
    await recordLlmUsage({
      userId: USER,
      model: "claude-haiku-4-5",
      slot: "quick",
      purpose: "chat",
      inputTokens: 100,
      outputTokens: 40,
    });
    await recordLlmUsage({
      userId: USER,
      model: "claude-haiku-4-5",
      slot: "quick",
      purpose: "chat",
      inputTokens: 50,
      outputTokens: 10,
    });
    const rows = await getUsageSummary(USER, new Date());
    const chat = rows.find((r) => r.purpose === "chat");
    expect(chat).toMatchObject({
      model: "claude-haiku-4-5",
      calls: 2,
      inputTokens: 150,
      outputTokens: 50,
    });
  });

  it("records nothing when the provider omitted usage (no estimates)", async () => {
    const { db, schema } = await import("@/lib/db");
    const { recordLlmUsage } = await import("@/lib/llm-usage");
    const before = await db.query.llmUsage.findMany({
      where: eq(schema.llmUsage.userId, USER),
    });
    await recordLlmUsage({
      userId: USER,
      model: "local-ollama",
      slot: "deep",
      purpose: "health_extract",
      inputTokens: undefined,
      outputTokens: undefined,
    });
    const after = await db.query.llmUsage.findMany({
      where: eq(schema.llmUsage.userId, USER),
    });
    expect(after.length).toBe(before.length);
  });
});
