import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, desc, eq } from "drizzle-orm";

const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

const USER = "test-monthly-report-user";
// July 3rd 06:00 — past the July 1st 04:00 slot; report covers June.
const NOW = new Date(2026, 6, 3, 6, 0, 0);

async function cleanup() {
  const { db, schema } = await import("@/lib/db");
  await db
    .delete(schema.chatThreads)
    .where(eq(schema.chatThreads.userId, USER));
  await db.delete(schema.activities).where(eq(schema.activities.userId, USER));
  await db
    .delete(schema.dailyMetrics)
    .where(eq(schema.dailyMetrics.userId, USER));
  await db.delete(schema.llmUsage).where(eq(schema.llmUsage.userId, USER));
  await db.delete(schema.users).where(eq(schema.users.id, USER));
}

describe("mostRecentMonthlySlot", () => {
  it("returns this month's 1st once passed, else last month's", async () => {
    const { mostRecentMonthlySlot } = await import("@/lib/monthly-report");
    const past = mostRecentMonthlySlot(new Date(2026, 6, 3, 6, 0), 4);
    expect([
      past.getFullYear(),
      past.getMonth(),
      past.getDate(),
      past.getHours(),
    ]).toEqual([2026, 6, 1, 4]);
    const before = mostRecentMonthlySlot(new Date(2026, 6, 1, 3, 0), 4);
    expect([before.getMonth(), before.getDate()]).toEqual([5, 1]);
    // Jan 1 before the hour → Dec 1 of the previous year.
    const jan = mostRecentMonthlySlot(new Date(2026, 0, 1, 2, 0), 4);
    expect([jan.getFullYear(), jan.getMonth()]).toEqual([2025, 11]);
  });
});

describe.skipIf(!hasDb)("generateMonthlyReport", () => {
  beforeAll(async () => {
    await cleanup();
    const { db, schema } = await import("@/lib/db");
    await db.insert(schema.users).values({
      id: USER,
      name: "Monthly",
      email: "monthly-report@example.invalid",
    });
    // 5 June sessions (report month) + 1 strava row that must not count.
    const values = [5, 12, 18, 24, 28].map((day, i) => ({
      userId: USER,
      provider: "intervals_icu" as const,
      externalId: `mr-${i}`,
      startDate: new Date(2026, 5, day, 10, 0),
      sport: "Ride",
      durationS: 3600,
      load: 60,
    }));
    await db.insert(schema.activities).values([
      ...values,
      {
        userId: USER,
        provider: "strava",
        externalId: "mr-strava",
        startDate: new Date(2026, 5, 15, 10, 0),
        sport: "Ride",
        durationS: 3600,
        load: 999,
      },
    ]);
  });

  afterAll(cleanup);

  it("posts once per cycle into a monthly thread", async () => {
    const { db, schema } = await import("@/lib/db");
    const { generateMonthlyReport } = await import("@/lib/monthly-report");
    await generateMonthlyReport(USER, { now: NOW, llm: async () => "" });
    const thread = await db.query.chatThreads.findFirst({
      where: and(
        eq(schema.chatThreads.userId, USER),
        eq(schema.chatThreads.kind, "monthly")
      ),
    });
    expect(thread).toBeTruthy();
    const msgs = await db.query.chatMessages.findMany({
      where: eq(schema.chatMessages.threadId, thread!.id),
    });
    expect(msgs.length).toBe(1);
    // Template path: June's honest totals, Strava excluded (300, not 1299).
    expect(msgs[0].content).toContain("300");
    expect(msgs[0].content).not.toContain("999");
    // Second run same cycle: no new message.
    await generateMonthlyReport(USER, { now: NOW, llm: async () => "" });
    const again = await db.query.chatMessages.findMany({
      where: eq(schema.chatMessages.threadId, thread!.id),
    });
    expect(again.length).toBe(1);
  });
});
