import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";

const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

const USER = "test-morning-backstop-user";
// Anchored to the REAL current date (only the hour changes): the code under
// test writes chatMessages.createdAt via the DB's real-time default, not the
// injected `now`, so the same-day dedup check (localYmd(now) ===
// localYmd(latest.createdAt)) only lines up if both fall on today's actual
// calendar day. A fixed past/future date here would desync the two and
// break the idempotency assertion below.
const BEFORE_HOUR = new Date();
BEFORE_HOUR.setHours(8, 30, 0, 0); // before backstop
const AFTER_HOUR = new Date();
AFTER_HOUR.setHours(9, 15, 0, 0); // after backstop

async function cleanup() {
  const { db, schema } = await import("@/lib/db");
  const threads = await db.query.chatThreads.findMany({
    where: eq(schema.chatThreads.userId, USER),
  });
  for (const t of threads) {
    await db
      .delete(schema.chatMessages)
      .where(eq(schema.chatMessages.threadId, t.id));
  }
  await db
    .delete(schema.chatThreads)
    .where(eq(schema.chatThreads.userId, USER));
  await db
    .delete(schema.connections)
    .where(eq(schema.connections.userId, USER));
  await db
    .delete(schema.dailyMetrics)
    .where(eq(schema.dailyMetrics.userId, USER));
  await db
    .delete(schema.wellnessDaily)
    .where(eq(schema.wellnessDaily.userId, USER));
  await db.delete(schema.users).where(eq(schema.users.id, USER));
}

describe.skipIf(!hasDb)("runMorningBriefBackstop", () => {
  beforeAll(async () => {
    await cleanup();
    const { db, schema } = await import("@/lib/db");
    const { encrypt } = await import("@/lib/crypto");
    await db
      .insert(schema.users)
      .values({
        id: USER,
        name: "Backstop",
        email: "backstop@example.invalid",
      })
      .onConflictDoNothing();
    await db.insert(schema.connections).values({
      userId: USER,
      provider: "intervals_icu",
      encryptedAccessToken: encrypt("fake-key"),
      externalAthleteId: "i-backstop",
      status: "active",
    });
  });

  beforeEach(async () => {
    const { db, schema } = await import("@/lib/db");
    const threads = await db.query.chatThreads.findMany({
      where: eq(schema.chatThreads.userId, USER),
    });
    for (const t of threads) {
      await db
        .delete(schema.chatMessages)
        .where(eq(schema.chatMessages.threadId, t.id));
    }
    await db
      .delete(schema.chatThreads)
      .where(eq(schema.chatThreads.userId, USER));
  });

  afterAll(cleanup);

  it("does nothing before the backstop hour", async () => {
    const { runMorningBriefBackstop } = await import("@/lib/sync/scheduler");
    expect(
      await runMorningBriefBackstop(BEFORE_HOUR, { userIds: [USER] })
    ).toBe(0);
  });

  it("forces a calibrating brief for a connected user past the backstop hour", async () => {
    const { runMorningBriefBackstop } = await import("@/lib/sync/scheduler");
    const { db, schema } = await import("@/lib/db");
    const fired = await runMorningBriefBackstop(AFTER_HOUR, {
      userIds: [USER],
    });
    expect(fired).toBe(1);

    // Scoped by kind: runMorningBriefBackstop also calls generateWeeklyReview
    // and generateMonthlyReport for this same user in the same pass, and both
    // create their own (here, empty) "weekly"/"monthly" chatThreads rows
    // before bailing out on insufficient data — an unscoped findFirst races
    // against those sibling rows (chatThreads.id is a random UUID, so
    // ordering with no ORDER BY is not guaranteed) and can intermittently
    // pick an empty thread instead of the "morning" one this test actually
    // wrote to. Same scoping convention already used by
    // monthly-report.test.ts / weekly-review.test.ts / morning-insight.test.ts
    // for this identical query shape.
    const thread = await db.query.chatThreads.findFirst({
      where: and(
        eq(schema.chatThreads.userId, USER),
        eq(schema.chatThreads.kind, "morning")
      ),
    });
    const msg = await db.query.chatMessages.findFirst({
      where: eq(schema.chatMessages.threadId, thread!.id),
    });
    expect(msg?.content).toContain("Still calibrating");
    expect(msg?.toolCalls).toMatchObject({ forced: true });
  });

  it("is idempotent — a second call the same morning fires nothing new", async () => {
    const { runMorningBriefBackstop } = await import("@/lib/sync/scheduler");
    await runMorningBriefBackstop(AFTER_HOUR, { userIds: [USER] });
    const laterSameMorning = new Date();
    laterSameMorning.setHours(10, 0, 0, 0);
    const second = await runMorningBriefBackstop(laterSameMorning, {
      userIds: [USER],
    });
    expect(second).toBe(0);
  });
});
