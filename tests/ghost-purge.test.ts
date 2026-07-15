import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

// Ghost-thread purge integration test (v0.4a). Requires Postgres; skips without.
const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

const USER = "test-ghost-purge-user";

async function cleanup() {
  const { db, schema } = await import("@/lib/db");
  await db
    .delete(schema.chatThreads)
    .where(eq(schema.chatThreads.userId, USER));
  await db.delete(schema.users).where(eq(schema.users.id, USER));
}

describe.skipIf(!hasDb)("ghost thread purge", () => {
  beforeAll(async () => {
    await cleanup();
    const { db, schema } = await import("@/lib/db");
    await db
      .insert(schema.users)
      .values({
        id: USER,
        name: "Ghost",
        email: "ghost-purge@example.invalid",
        role: "member",
      })
      .onConflictDoNothing();
  });

  afterAll(cleanup);

  it("deletes only ghost threads idle for 24h, cascading messages", async () => {
    const { db, schema } = await import("@/lib/db");
    const { purgeEphemeralThreads } = await import("@/lib/sync/scheduler");

    const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
    const [staleGhost] = await db
      .insert(schema.chatThreads)
      .values({ userId: USER, title: "stale ghost", ephemeral: true })
      .returning();
    const [freshGhost] = await db
      .insert(schema.chatThreads)
      .values({ userId: USER, title: "fresh ghost", ephemeral: true })
      .returning();
    const [staleNormal] = await db
      .insert(schema.chatThreads)
      .values({ userId: USER, title: "stale normal", ephemeral: false })
      .returning();
    // Age the stale threads (updatedAt has defaultNow on insert).
    for (const id of [staleGhost.id, staleNormal.id]) {
      await db
        .update(schema.chatThreads)
        .set({ updatedAt: old })
        .where(eq(schema.chatThreads.id, id));
    }
    await db.insert(schema.chatMessages).values({
      threadId: staleGhost.id,
      role: "user",
      content: "should cascade away",
    });

    const purged = await purgeEphemeralThreads();
    expect(purged).toBeGreaterThanOrEqual(1);

    const remaining = await db.query.chatThreads.findMany({
      where: eq(schema.chatThreads.userId, USER),
    });
    const ids = remaining.map((t) => t.id).sort();
    expect(ids).toEqual([freshGhost.id, staleNormal.id].sort());

    const orphanMessages = await db.query.chatMessages.findMany({
      where: eq(schema.chatMessages.threadId, staleGhost.id),
    });
    expect(orphanMessages).toHaveLength(0);
  });
});
