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
  // v0.9.2: week plans (plan_adjustments cascade with them)
  await db.delete(schema.weekPlans).where(eq(schema.weekPlans.userId, USER));
  await db
    .delete(schema.trainingPlans)
    .where(eq(schema.trainingPlans.userId, USER));
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
    await db.delete(schema.weekPlans).where(eq(schema.weekPlans.userId, USER));
    await db
      .delete(schema.trainingPlans)
      .where(eq(schema.trainingPlans.userId, USER));
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

  it("quotes today's plan adjustments verbatim in the template", async () => {
    const { db, schema } = await import("@/lib/db");
    const { generateMorningInsight } = await import("@/lib/morning-insight");
    await seedMetric({ band: "red", readiness: 25 });

    const now = new Date();
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    const weekStart = localYmd(monday);
    const [plan] = await db
      .insert(schema.trainingPlans)
      .values({
        userId: USER,
        title: "Insight test plan",
        raceType: "marathon",
        raceDate: localYmd(new Date(now.getTime() + 60 * 86_400_000)),
        startDate: weekStart,
        weeksTotal: 8,
        currentWeek: 1,
        status: "active",
      })
      .returning();
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      return {
        date: localYmd(d),
        availableMins: 60,
        workout: null,
        status: "rest",
      };
    });
    const [week] = await db
      .insert(schema.weekPlans)
      .values({
        userId: USER,
        planId: plan.id,
        weekStart,
        skeletonWeek: 1,
        days,
        status: "open",
      })
      .returning();
    const reason = "readiness red — Intervals replaced by recovery";
    await db.insert(schema.planAdjustments).values({
      weekPlanId: week.id,
      date: localYmd(now),
      trigger: "low_readiness",
      action: "swapped",
      reason,
    });

    const result = await generateMorningInsight(USER);
    if (result === "skipped") throw new Error("expected insight");
    expect(result.text).toContain(reason);
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

  // Fix: a post-race debrief message landing in the morning thread (e.g. a
  // post-midnight sync tick) must not be mistaken for "today's morning
  // insight" — that would silently eat the athlete's real morning check-in.
  it("a race-debrief message today does not suppress the morning insight", async () => {
    const { db, schema } = await import("@/lib/db");
    const { generateMorningInsight, findOrCreateMorningThread } =
      await import("@/lib/morning-insight");
    await seedMetric();

    const thread = await findOrCreateMorningThread(USER);
    await db.insert(schema.chatMessages).values({
      threadId: thread.id,
      role: "assistant",
      content: "No activity landed for Test Race — mark it yourself.",
      toolCalls: {
        generated: "race_debrief",
        kind: "race_debrief",
        raceId: null,
      },
    });

    const result = await generateMorningInsight(USER);
    expect(result).not.toBe("skipped");
  });

  it("getLatestMorningInsight ignores a race-debrief message and returns the last real insight", async () => {
    const { db, schema } = await import("@/lib/db");
    const {
      generateMorningInsight,
      getLatestMorningInsight,
      findOrCreateMorningThread,
    } = await import("@/lib/morning-insight");
    await seedMetric();

    const result = await generateMorningInsight(USER);
    if (result === "skipped") throw new Error("expected insight");

    const thread = await findOrCreateMorningThread(USER);
    await db.insert(schema.chatMessages).values({
      threadId: thread.id,
      role: "assistant",
      content: "Debrief text",
      toolCalls: {
        generated: "race_debrief",
        kind: "race_debrief",
        raceId: null,
      },
    });

    const latest = await getLatestMorningInsight(USER);
    expect(latest?.text).toBe(result.text);
  });
});

// Task 12: race-day brief — the morning insight goes race-aware when a race
// with status="upcoming" lands on today's date.
describe.skipIf(!hasDb)("morning insight — race day (Task 12)", () => {
  const RACE_USER = "test-morning-insight-race-user";
  const RACE_USER_2 = "test-morning-insight-race-user-2";
  const RACE_USER_3 = "test-morning-insight-race-user-3";
  const RACE_USERS = [RACE_USER, RACE_USER_2, RACE_USER_3];

  async function cleanupRaceUser(id: string) {
    const { db, schema } = await import("@/lib/db");
    const threads = await db.query.chatThreads.findMany({
      where: eq(schema.chatThreads.userId, id),
    });
    for (const t of threads) {
      await db
        .delete(schema.chatMessages)
        .where(eq(schema.chatMessages.threadId, t.id));
    }
    await db
      .delete(schema.chatThreads)
      .where(eq(schema.chatThreads.userId, id));
    await db.delete(schema.races).where(eq(schema.races.userId, id));
    await db
      .delete(schema.dailyMetrics)
      .where(eq(schema.dailyMetrics.userId, id));
    await db.delete(schema.weekPlans).where(eq(schema.weekPlans.userId, id));
    await db
      .delete(schema.trainingPlans)
      .where(eq(schema.trainingPlans.userId, id));
    await db.delete(schema.users).where(eq(schema.users.id, id));
  }

  beforeAll(async () => {
    for (const id of RACE_USERS) await cleanupRaceUser(id);
    const { db, schema } = await import("@/lib/db");
    await db
      .insert(schema.users)
      .values(
        RACE_USERS.map((id, i) => ({
          id,
          name: `Racer ${i + 1}`,
          email: `race-day-${i + 1}@example.invalid`,
          role: "member" as const,
        }))
      )
      .onConflictDoNothing();
  });

  afterAll(async () => {
    for (const id of RACE_USERS) await cleanupRaceUser(id);
  });

  it("race day: brief leads with the race and still posts while calibrating", async () => {
    const { createRace } = await import("@/lib/race/service");
    const { generateMorningInsight } = await import("@/lib/morning-insight");
    const today = localYmd(new Date());
    await createRace(RACE_USER, {
      name: "Test Marathon",
      raceType: "marathon",
      date: today,
      priority: "A",
      goalNote: "start easy",
    });

    // No daily_metrics row at all → calibrating/missing-readiness path.
    let seenInstruction = "";
    const r = await generateMorningInsight(RACE_USER, {
      llm: async (p) => {
        seenInstruction = p;
        return "Race brief text";
      },
    });
    expect(r).not.toBe("skipped");
    expect(seenInstruction).toContain("Test Marathon");
    expect(seenInstruction).toContain("race");
    expect(seenInstruction).toContain("start easy");
    expect(seenInstruction).toContain("calibrating");
    // No yesterday daily_metrics row → projected/actual TSB lines omitted.
    expect(seenInstruction).not.toContain("Projected TSB");
  });

  it("race-day template fallback names the race", async () => {
    // Second same-day call is guarded; use a second user for the template path.
    const { createRace } = await import("@/lib/race/service");
    const { generateMorningInsight } = await import("@/lib/morning-insight");
    const today = localYmd(new Date());
    await createRace(RACE_USER_2, {
      name: "Second City 10K",
      raceType: "10k",
      date: today,
      priority: "B",
      goalNote: null,
    });

    const r = await generateMorningInsight(RACE_USER_2, {
      llm: async () => "", // empty LLM output → template fallback
    });
    expect(r).not.toBe("skipped");
    if (r !== "skipped") expect(r.text).toMatch(/^Race day: /);
  });

  it("race day: projects tomorrow-vs-actual TSB from yesterday's stored ctl/atl", async () => {
    const { db, schema } = await import("@/lib/db");
    const { createRace } = await import("@/lib/race/service");
    const { generateMorningInsight } = await import("@/lib/morning-insight");
    const today = localYmd(new Date());
    const yesterdayDate = new Date();
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const yesterday = localYmd(yesterdayDate);

    await createRace(RACE_USER_3, {
      name: "Projection 5K",
      raceType: "5k",
      date: today,
      priority: "C",
      goalNote: null,
    });
    // Yesterday's stored load (no week plan for this user → 0 planned load).
    await db.insert(schema.dailyMetrics).values({
      userId: RACE_USER_3,
      date: yesterday,
      ctl: 50,
      atl: 40,
    });
    // Today's actual metrics (readiness present, non-calibrating).
    await db.insert(schema.dailyMetrics).values({
      userId: RACE_USER_3,
      date: today,
      readiness: 70,
      band: "green",
      tsb: 8,
      hrvBaselineMean: Math.log(65),
      hrvBaselineSd: 0.1,
      rhrBaselineMean: 48,
      rhrBaselineSd: 2,
    });

    let seenInstruction = "";
    const r = await generateMorningInsight(RACE_USER_3, {
      llm: async (p) => {
        seenInstruction = p;
        return "Race brief text";
      },
    });
    expect(r).not.toBe("skipped");
    // pCtl = 50 + (0-50)/42 ≈ 48.8095; pAtl = 40 + (0-40)/7 ≈ 34.2857
    // projected = round((pCtl-pAtl)*10)/10 = 14.5; actual = round(8*10)/10 = 8
    expect(seenInstruction).toContain("Projected TSB 14.5 vs actual 8");
  });
});
