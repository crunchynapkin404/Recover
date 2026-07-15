import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";

const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

const USER = "test-weekly-review-user";

function localYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

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
    .delete(schema.activities)
    .where(eq(schema.activities.userId, USER));
  await db
    .delete(schema.dailyMetrics)
    .where(eq(schema.dailyMetrics.userId, USER));
  await db
    .delete(schema.wellnessDaily)
    .where(eq(schema.wellnessDaily.userId, USER));
  await db
    .delete(schema.notificationPrefs)
    .where(eq(schema.notificationPrefs.userId, USER));
  await db.delete(schema.users).where(eq(schema.users.id, USER));
}

async function seedActivities(count: number) {
  const { db, schema } = await import("@/lib/db");
  const now = new Date();
  for (let i = 0; i < count; i++) {
    const startDate = new Date(now);
    startDate.setDate(startDate.getDate() - i);
    await db.insert(schema.activities).values({
      userId: USER,
      provider: "intervals_icu",
      externalId: `weekly-test-${i}-${Date.now()}`,
      startDate,
      sport: "Ride",
      name: `Ride ${i}`,
      load: 50 + i * 10,
    });
  }
}

async function seedMetrics() {
  const { db, schema } = await import("@/lib/db");
  const now = new Date();
  for (let i = 0; i < 7; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    await db
      .insert(schema.dailyMetrics)
      .values({
        userId: USER,
        date: localYmd(d),
        readiness: 65 + i,
        band: "green",
        tsb: 5 - i,
      })
      .onConflictDoNothing();
  }
}

async function seedWellness() {
  const { db, schema } = await import("@/lib/db");
  const now = new Date();
  await db
    .insert(schema.wellnessDaily)
    .values({
      userId: USER,
      date: localYmd(now),
      ctl: 55,
      atl: 60,
    })
    .onConflictDoNothing();
}

describe.skipIf(!hasDb)("weekly review", () => {
  beforeAll(async () => {
    await cleanup();
    const { db, schema } = await import("@/lib/db");
    await db
      .insert(schema.users)
      .values({
        id: USER,
        name: "WeeklyTest",
        email: "weekly-review@example.invalid",
        role: "member",
      })
      .onConflictDoNothing();
    // Set review prefs to current day/hour so the day/hour guard passes
    const now = new Date();
    await db
      .insert(schema.notificationPrefs)
      .values({
        userId: USER,
        weeklyReviewDay: now.getDay(),
        weeklyReviewHour: now.getHours(),
      })
      .onConflictDoNothing();
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
    await db
      .delete(schema.activities)
      .where(eq(schema.activities.userId, USER));
    await db
      .delete(schema.dailyMetrics)
      .where(eq(schema.dailyMetrics.userId, USER));
    await db
      .delete(schema.wellnessDaily)
      .where(eq(schema.wellnessDaily.userId, USER));
  });

  afterAll(cleanup);

  it("skips if fewer than 3 activities exist", async () => {
    const { db, schema } = await import("@/lib/db");
    const { generateWeeklyReview } = await import("@/lib/weekly-review");

    await seedActivities(2); // only 2
    await generateWeeklyReview(USER);

    // No thread messages should be created
    const threads = await db.query.chatThreads.findMany({
      where: and(
        eq(schema.chatThreads.userId, USER),
        eq(schema.chatThreads.kind, "weekly"),
      ),
    });
    // Thread might exist (created during guard check) but no messages
    for (const t of threads) {
      const msgs = await db.query.chatMessages.findMany({
        where: eq(schema.chatMessages.threadId, t.id),
      });
      expect(msgs).toHaveLength(0);
    }
  });

  it("generates a template message when no LLM is configured", async () => {
    const { db, schema } = await import("@/lib/db");
    const { generateWeeklyReview, WEEKLY_THREAD_TITLE } =
      await import("@/lib/weekly-review");

    await seedActivities(5);
    await seedMetrics();
    await seedWellness();

    await generateWeeklyReview(USER);

    const thread = await db.query.chatThreads.findFirst({
      where: and(
        eq(schema.chatThreads.userId, USER),
        eq(schema.chatThreads.kind, "weekly"),
      ),
    });
    expect(thread).toBeDefined();
    expect(thread?.title).toBe(WEEKLY_THREAD_TITLE);

    const msgs = await db.query.chatMessages.findMany({
      where: eq(schema.chatMessages.threadId, thread!.id),
    });
    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe("system");
    expect(msgs[0].content).toContain("Week in review");
    expect(msgs[0].content).toContain("load across");

    const meta = msgs[0].toolCalls as { week: string; generated: string };
    expect(meta.generated).toBe("template");
  });

  it("at-most-once guard: running twice does not duplicate", async () => {
    const { db, schema } = await import("@/lib/db");
    const { generateWeeklyReview } = await import("@/lib/weekly-review");

    await seedActivities(5);
    await seedMetrics();
    await seedWellness();

    await generateWeeklyReview(USER);
    await generateWeeklyReview(USER); // second call

    const thread = await db.query.chatThreads.findFirst({
      where: and(
        eq(schema.chatThreads.userId, USER),
        eq(schema.chatThreads.kind, "weekly"),
      ),
    });
    expect(thread).toBeDefined();

    const msgs = await db.query.chatMessages.findMany({
      where: eq(schema.chatMessages.threadId, thread!.id),
    });
    expect(msgs).toHaveLength(1); // only one message, not two
  });
});
