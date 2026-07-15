import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

// Coach memory service integration tests (v0.4a). Requires Postgres; skips without.
const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

const USER_A = "test-coach-memory-a";
const USER_B = "test-coach-memory-b";

async function cleanup() {
  const { db, schema } = await import("@/lib/db");
  for (const id of [USER_A, USER_B]) {
    await db
      .delete(schema.coachMemories)
      .where(eq(schema.coachMemories.userId, id));
    await db.delete(schema.users).where(eq(schema.users.id, id));
  }
}

describe.skipIf(!hasDb)("coach memory service", () => {
  beforeAll(async () => {
    await cleanup();
    const { db, schema } = await import("@/lib/db");
    for (const [id, email] of [
      [USER_A, "coach-mem-a@example.invalid"],
      [USER_B, "coach-mem-b@example.invalid"],
    ] as const) {
      await db
        .insert(schema.users)
        .values({ id, name: id, email, role: "member" })
        .onConflictDoNothing();
    }
  });

  beforeEach(async () => {
    const { db, schema } = await import("@/lib/db");
    for (const id of [USER_A, USER_B]) {
      await db
        .delete(schema.coachMemories)
        .where(eq(schema.coachMemories.userId, id));
    }
  });

  afterAll(cleanup);

  it("saves, trims, and lists a memory", async () => {
    const { saveMemory, listMemories } = await import("@/lib/coach-memory");
    const result = await saveMemory(USER_A, "race", "  Gran Fondo June 7  ");
    expect(result).toMatchObject({ ok: true });
    const rows = await listMemories(USER_A);
    expect(rows).toHaveLength(1);
    expect(rows[0].category).toBe("race");
    expect(rows[0].content).toBe("Gran Fondo June 7");
  });

  it("rejects over-long and empty content", async () => {
    const { saveMemory, MEMORY_MAX_CONTENT_CHARS } =
      await import("@/lib/coach-memory");
    expect(
      await saveMemory(USER_A, "fact", "x".repeat(MEMORY_MAX_CONTENT_CHARS + 1))
    ).toEqual({ ok: false, reason: "too_long" });
    expect(await saveMemory(USER_A, "fact", "   ")).toEqual({
      ok: false,
      reason: "too_long",
    });
  });

  it("enforces the 50-entry cap", async () => {
    const { db, schema } = await import("@/lib/db");
    const { saveMemory, MEMORY_MAX_ENTRIES } =
      await import("@/lib/coach-memory");
    await db.insert(schema.coachMemories).values(
      Array.from({ length: MEMORY_MAX_ENTRIES - 1 }, (_, i) => ({
        userId: USER_A,
        category: "fact" as const,
        content: `fact ${i}`,
      }))
    );
    expect(await saveMemory(USER_A, "fact", "the 50th")).toMatchObject({
      ok: true,
    });
    expect(await saveMemory(USER_A, "fact", "the 51st")).toEqual({
      ok: false,
      reason: "memory_full",
    });
  });

  it("isolates users on update and delete", async () => {
    const { saveMemory, updateMemory, deleteMemory, listMemories } =
      await import("@/lib/coach-memory");
    const saved = await saveMemory(USER_A, "goal", "sub-3 marathon");
    if (!saved.ok) throw new Error("save failed");
    expect(await updateMemory(USER_B, saved.id, "hijacked")).toBe(false);
    expect(await deleteMemory(USER_B, saved.id)).toBe(false);
    const rows = await listMemories(USER_A);
    expect(rows[0].content).toBe("sub-3 marathon");
    expect(await updateMemory(USER_A, saved.id, "sub-2:55 marathon")).toBe(
      true
    );
  });

  it("deletes by unambiguous id prefix only", async () => {
    const { saveMemory, deleteMemoryByPrefix } =
      await import("@/lib/coach-memory");
    const saved = await saveMemory(USER_A, "preference", "hates trainers");
    if (!saved.ok) throw new Error("save failed");
    expect(await deleteMemoryByPrefix(USER_A, "short")).toBe("not_found");
    expect(await deleteMemoryByPrefix(USER_A, "ffffffff")).toBe("not_found");
    expect(await deleteMemoryByPrefix(USER_A, saved.id.slice(0, 8))).toBe(
      "deleted"
    );
  });

  it("builds a capped prompt block with goals first", async () => {
    const { db, schema } = await import("@/lib/db");
    const { saveMemory, memoryPromptBlock } =
      await import("@/lib/coach-memory");
    expect(await memoryPromptBlock(USER_A)).toBe("");

    await saveMemory(USER_A, "fact", "prefers morning rides");
    await saveMemory(USER_A, "goal", "raise FTP to 300W");
    const block = await memoryPromptBlock(USER_A);
    expect(block).toContain("## What you know about this athlete");
    expect(block).toContain("(goal) raise FTP to 300W");
    expect(block.indexOf("(goal)")).toBeLessThan(block.indexOf("(fact)"));

    // 49 more long entries → block must stay capped and note truncation
    await db.insert(schema.coachMemories).values(
      Array.from({ length: 48 }, (_, i) => ({
        userId: USER_A,
        category: "fact" as const,
        content: `long filler memory number ${i} `.padEnd(270, "x"),
      }))
    );
    const capped = await memoryPromptBlock(USER_A);
    expect(capped.length).toBeLessThanOrEqual(2100);
    expect(capped).toContain("…(memory truncated)");
  });
});
