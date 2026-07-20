import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

const USER = "test-recall-user";
const OTHER = "test-recall-other";

async function cleanup() {
  const { db, schema } = await import("@/lib/db");
  for (const id of [USER, OTHER]) {
    await db
      .delete(schema.chatThreads)
      .where(eq(schema.chatThreads.userId, id)); // messages cascade
    await db
      .delete(schema.wellnessDaily)
      .where(eq(schema.wellnessDaily.userId, id));
    await db.delete(schema.users).where(eq(schema.users.id, id));
  }
}

describe.skipIf(!hasDb)("recall searchHistory", () => {
  let threadId = "";

  beforeAll(async () => {
    await cleanup();
    const { db, schema } = await import("@/lib/db");
    await db.insert(schema.users).values([
      { id: USER, name: "Recall", email: "recall@example.invalid" },
      { id: OTHER, name: "Other", email: "recall-other@example.invalid" },
    ]);
    const [chat] = await db
      .insert(schema.chatThreads)
      .values({ userId: USER, title: "Knee talk", kind: "chat" })
      .returning();
    threadId = chat.id;
    const [weekly] = await db
      .insert(schema.chatThreads)
      .values({ userId: USER, title: "Weekly Review", kind: "weekly" })
      .returning();
    const [ghost] = await db
      .insert(schema.chatThreads)
      .values({ userId: USER, title: "Ghost", kind: "chat", ephemeral: true })
      .returning();
    const [otherThread] = await db
      .insert(schema.chatThreads)
      .values({ userId: OTHER, title: "Other user", kind: "chat" })
      .returning();
    await db.insert(schema.chatMessages).values([
      {
        threadId: chat.id,
        role: "user",
        content: "my knee hurts after long rides",
      },
      {
        threadId: chat.id,
        role: "user",
        content: "mijn knie doet pijn na lange ritten",
      },
      {
        threadId: weekly.id,
        role: "assistant",
        content: "Big week: watch the knee load",
      },
      {
        threadId: ghost.id,
        role: "user",
        content: "knee secret in a ghost thread",
      },
      {
        threadId: otherThread.id,
        role: "user",
        content: "knee message of another user",
      },
    ]);
    await db.insert(schema.wellnessDaily).values({
      userId: USER,
      date: "2026-07-01",
      source: "manual",
      notes: "zware training, knie voelde stijf",
    });
  });

  afterAll(cleanup);

  it("finds English and Dutch exact tokens", async () => {
    const { db } = await import("@/lib/db");
    const { searchHistory } = await import("@/lib/recall");
    const en = await searchHistory(db, { userId: USER, query: "knee" });
    expect(en.some((h) => h.snippet.includes("knee"))).toBe(true);
    const nl = await searchHistory(db, { userId: USER, query: "knie" });
    expect(nl.length).toBeGreaterThan(0);
  });

  it("labels sources by thread kind and journal", async () => {
    const { db } = await import("@/lib/db");
    const { searchHistory } = await import("@/lib/recall");
    const hits = await searchHistory(db, { userId: USER, query: "knee" });
    expect(hits.some((h) => h.source === "chat")).toBe(true);
    expect(hits.some((h) => h.source === "weekly")).toBe(true);
    const journal = await searchHistory(db, { userId: USER, query: "knie" });
    expect(
      journal.some((h) => h.source === "journal" && h.date === "2026-07-01")
    ).toBe(true);
  });

  it("never returns ghost threads, other users, or the excluded thread", async () => {
    const { db } = await import("@/lib/db");
    const { searchHistory } = await import("@/lib/recall");
    const hits = await searchHistory(db, {
      userId: USER,
      query: "knee OR knie",
    });
    expect(hits.some((h) => h.snippet.includes("ghost"))).toBe(false);
    expect(hits.some((h) => h.snippet.includes("another user"))).toBe(false);
    const excluded = await searchHistory(db, {
      userId: USER,
      query: "knee",
      excludeThreadId: threadId,
    });
    expect(excluded.some((h) => h.threadTitle === "Knee talk")).toBe(false);
  });

  it("returns [] for empty queries and clamps limit", async () => {
    const { db } = await import("@/lib/db");
    const { searchHistory, RECALL_MAX_LIMIT } = await import("@/lib/recall");
    expect(await searchHistory(db, { userId: USER, query: "   " })).toEqual([]);
    const clamped = await searchHistory(db, {
      userId: USER,
      query: "knee",
      limit: 99,
    });
    expect(clamped.length).toBeLessThanOrEqual(RECALL_MAX_LIMIT);
  });
});
