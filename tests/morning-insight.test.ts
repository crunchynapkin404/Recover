import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

// Morning insight service integration tests (v0.4b). Requires Postgres.
const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

const USER = "test-morning-insight-user";

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
    .delete(schema.dailyMetrics)
    .where(eq(schema.dailyMetrics.userId, USER));
  await db
    .delete(schema.wellnessDaily)
    .where(eq(schema.wellnessDaily.userId, USER));
  await db.delete(schema.users).where(eq(schema.users.id, USER));
}

async function seedMetric(
  overrides: Partial<{
    readiness: number | null;
    band: "green" | "amber" | "red" | "calibrating";
    tsb: number;
    hrvBaselineMean: number | null;
    hrvBaselineSd: number | null;
  }> = {}
) {
  const { db, schema } = await import("@/lib/db");
  await db.insert(schema.dailyMetrics).values({
    userId: USER,
    date: localYmd(new Date()),
    readiness: overrides.readiness === undefined ? 70 : overrides.readiness,
    band: overrides.band ?? "green",
    tsb: overrides.tsb ?? 5,
    hrvBaselineMean: overrides.hrvBaselineMean ?? Math.log(65),
    hrvBaselineSd: overrides.hrvBaselineSd ?? 0.1,
    rhrBaselineMean: 48,
    rhrBaselineSd: 2,
  });
}

describe.skipIf(!hasDb)("morning insight", () => {
  beforeAll(async () => {
    await cleanup();
    const { db, schema } = await import("@/lib/db");
    await db
      .insert(schema.users)
      .values({
        id: USER,
        name: "Morning",
        email: "morning-insight@example.invalid",
        role: "member",
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
      .delete(schema.dailyMetrics)
      .where(eq(schema.dailyMetrics.userId, USER));
    await db
      .delete(schema.wellnessDaily)
      .where(eq(schema.wellnessDaily.userId, USER));
  });

  afterAll(cleanup);

  it("writes one template insight per day into the morning thread", async () => {
    const { db, schema } = await import("@/lib/db");
    const { generateMorningInsight, MORNING_THREAD_TITLE } =
      await import("@/lib/morning-insight");
    await seedMetric();

    const first = await generateMorningInsight(USER);
    expect(first).not.toBe("skipped");
    if (first === "skipped") throw new Error("unreachable");
    expect(first.text).toContain("Readiness 70");
    expect(first.warning).toBeNull();

    const thread = await db.query.chatThreads.findFirst({
      where: eq(schema.chatThreads.userId, USER),
    });
    expect(thread?.kind).toBe("morning");
    expect(thread?.title).toBe(MORNING_THREAD_TITLE);

    expect(await generateMorningInsight(USER)).toBe("skipped");
    const messages = await db.query.chatMessages.findMany({
      where: eq(schema.chatMessages.threadId, first.threadId),
    });
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("assistant");
    expect(messages[0].toolCalls).toMatchObject({
      generated: "template",
      warning: null,
    });
  });

  it("skips while calibrating or without metrics", async () => {
    const { generateMorningInsight } = await import("@/lib/morning-insight");
    expect(await generateMorningInsight(USER)).toBe("skipped");
    await seedMetric({ readiness: null, band: "calibrating" });
    expect(await generateMorningInsight(USER)).toBe("skipped");
  });

  it("flags an overtraining warning in text and metadata", async () => {
    const { db, schema } = await import("@/lib/db");
    const { generateMorningInsight } = await import("@/lib/morning-insight");
    await seedMetric({ band: "red", readiness: 25 });
    // 21 days of suppressed HRV (ln(50) < ln(65) - 0.1)
    const today = new Date();
    await db.insert(schema.wellnessDaily).values(
      Array.from({ length: 21 }, (_, i) => {
        const d = new Date(today);
        d.setDate(d.getDate() - (20 - i));
        return { userId: USER, date: localYmd(d), hrvMs: 50, restingHr: 48 };
      })
    );

    const result = await generateMorningInsight(USER);
    if (result === "skipped") throw new Error("expected insight");
    expect(result.warning?.kind).toBe("hrv_suppression");
    expect(result.text).toContain("HRV");
    const msg = await db.query.chatMessages.findFirst({
      where: eq(schema.chatMessages.threadId, result.threadId),
    });
    expect(msg?.toolCalls).toMatchObject({ warning: "hrv_suppression" });
  });

  it("uses an injected llm and records generated=llm", async () => {
    const { db, schema } = await import("@/lib/db");
    const { generateMorningInsight } = await import("@/lib/morning-insight");
    await seedMetric();
    const result = await generateMorningInsight(USER, {
      llm: async () => "Custom morning text.",
    });
    if (result === "skipped") throw new Error("expected insight");
    expect(result.text).toBe("Custom morning text.");
    const msg = await db.query.chatMessages.findFirst({
      where: eq(schema.chatMessages.threadId, result.threadId),
    });
    expect(msg?.toolCalls).toMatchObject({ generated: "llm" });
  });

  it("getLatestMorningInsight returns today's insight only", async () => {
    const { db, schema } = await import("@/lib/db");
    const { generateMorningInsight, getLatestMorningInsight } =
      await import("@/lib/morning-insight");
    await seedMetric();
    expect(await getLatestMorningInsight(USER)).toBeNull();

    const result = await generateMorningInsight(USER);
    if (result === "skipped") throw new Error("expected insight");
    const latest = await getLatestMorningInsight(USER);
    expect(latest?.threadId).toBe(result.threadId);
    expect(latest?.text).toBe(result.text);

    // Age the message to yesterday → no card today.
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await db
      .update(schema.chatMessages)
      .set({ createdAt: yesterday })
      .where(eq(schema.chatMessages.threadId, result.threadId));
    expect(await getLatestMorningInsight(USER)).toBeNull();
  });
});
