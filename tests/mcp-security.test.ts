import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";

// P4R security tests the P4 gate required: revoked token rejection, scope
// enforcement, cross-user isolation, and auth-before-dispatch. Integration —
// requires Postgres; skips without DATABASE_URL.
const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

const USER_A = "test-mcp-user-a";
const USER_B = "test-mcp-user-b";

type Extra = Parameters<
  typeof import("@/lib/mcp/server").executeToolHandler
>[2];

function authExtra(userId: string | undefined, scopes: string[]): Extra {
  return { authInfo: { extra: { userId }, scopes } } as unknown as Extra;
}

function toolByName(name: string) {
  // Lazy import inside tests keeps module load after env checks.
  return import("@/lib/tools/registry").then(({ allTools }) => {
    const tool = allTools.find((t) => t.name === name);
    if (!tool) throw new Error(`tool ${name} not in registry`);
    return tool;
  });
}

describe.skipIf(!hasDb)("MCP security gates", () => {
  beforeAll(async () => {
    const { db, schema } = await import("@/lib/db");
    for (const [id, email] of [
      [USER_A, "mcp-a@example.invalid"],
      [USER_B, "mcp-b@example.invalid"],
    ] as const) {
      await db
        .insert(schema.users)
        .values({ id, name: id, email })
        .onConflictDoNothing();
    }
    await db
      .insert(schema.wellnessDaily)
      .values({
        userId: USER_A,
        date: "2026-07-10",
        hrvMs: 61,
        source: "manual",
      })
      .onConflictDoNothing();
  });

  afterAll(async () => {
    const { db, schema } = await import("@/lib/db");
    for (const id of [USER_A, USER_B]) {
      await db.delete(schema.apiTokens).where(eq(schema.apiTokens.userId, id));
      await db
        .delete(schema.wellnessDaily)
        .where(eq(schema.wellnessDaily.userId, id));
      await db
        .delete(schema.dailyMetrics)
        .where(eq(schema.dailyMetrics.userId, id));
      await db.delete(schema.users).where(eq(schema.users.id, id));
    }
  });

  it("rejects a revoked token at resolution", async () => {
    const { db, schema } = await import("@/lib/db");
    const { hashToken, lookupPrefixFromHash, resolveToken } =
      await import("@/lib/mcp/token-auth");
    const plaintext = `rec_test_${randomBytes(16).toString("hex")}`;
    const hash = hashToken(plaintext);
    const [row] = await db
      .insert(schema.apiTokens)
      .values({
        userId: USER_A,
        tokenHash: hash,
        lookupPrefix: lookupPrefixFromHash(hash),
        label: "test",
        scopes: "read",
      })
      .returning();

    expect(await resolveToken(plaintext)).toMatchObject({ userId: USER_A });

    await db
      .update(schema.apiTokens)
      .set({ revokedAt: new Date() })
      .where(eq(schema.apiTokens.id, row.id));

    expect(await resolveToken(plaintext)).toBeNull();
  });

  it("rejects dispatch without authInfo (auth before execution)", async () => {
    const { executeToolHandler } = await import("@/lib/mcp/server");
    const tool = await toolByName("get_wellness");
    const result = await executeToolHandler(
      tool,
      { days: 7 },
      authExtra(undefined, ["read"])
    );
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("Authentication required");
  });

  it("rejects a write tool without write:wellness scope", async () => {
    const { executeToolHandler } = await import("@/lib/mcp/server");
    const tool = await toolByName("log_wellness");
    const result = await executeToolHandler(
      tool,
      { date: "2026-07-11", energy: 5 },
      authExtra(USER_A, ["read"])
    );
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("write:wellness");
  });

  it("rejects remember_fact without write:memory scope", async () => {
    const { executeToolHandler } = await import("@/lib/mcp/server");
    const tool = await toolByName("remember_fact");
    const result = await executeToolHandler(
      tool,
      { category: "fact", content: "MCP write attempt" },
      authExtra(USER_A, ["read", "write:wellness"])
    );
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("write:memory");
  });

  it("rejects read tools for a token without the read scope", async () => {
    const { executeToolHandler } = await import("@/lib/mcp/server");
    const tool = await toolByName("get_wellness");
    const result = await executeToolHandler(
      tool,
      { days: 7 },
      authExtra(USER_A, ["write:wellness"])
    );
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("read required");
  });

  it("allows a correctly scoped write and recomputes metrics", async () => {
    const { executeToolHandler } = await import("@/lib/mcp/server");
    const tool = await toolByName("log_wellness");
    const result = await executeToolHandler(
      tool,
      { date: "2026-07-10", energy: 7 },
      authExtra(USER_A, ["read", "write:wellness"])
    );
    expect(result.isError).toBeUndefined();
    const payload = JSON.parse((result.content[0] as { text: string }).text);
    expect(payload).toMatchObject({ saved: true, date: "2026-07-10" });
  });

  it("isolates users: B cannot read A's wellness", async () => {
    const { executeToolHandler } = await import("@/lib/mcp/server");
    const tool = await toolByName("get_wellness");
    const result = await executeToolHandler(
      tool,
      { days: 3650 },
      authExtra(USER_B, ["read"])
    );
    expect(result.isError).toBeUndefined();
    const payload = JSON.parse((result.content[0] as { text: string }).text);
    expect(payload.count).toBe(0);
    expect(payload.days).toEqual([]);
  });

  it("read scope grants all four v0.4c depth tools", async () => {
    const { executeToolHandler } = await import("@/lib/mcp/server");
    for (const name of [
      "get_power_curve",
      "get_pace_curve",
      "get_best_efforts",
      "get_training_load_summary",
    ]) {
      const tool = await toolByName(name);
      const result = await executeToolHandler(
        tool,
        {},
        authExtra(USER_A, ["read"])
      );
      expect(result.isError, `${name} should accept read scope`).toBeUndefined();
    }
  });

  it("denies the depth tools without read scope", async () => {
    const { executeToolHandler } = await import("@/lib/mcp/server");
    const tool = await toolByName("get_power_curve");
    const result = await executeToolHandler(
      tool,
      {},
      authExtra(USER_A, ["write:wellness"])
    );
    expect(result.isError).toBe(true);
  });
});
