import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";

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

  it("force:true posts a degraded brief when calibrating, with real readiness untouched", async () => {
    const { generateMorningInsight } = await import("@/lib/morning-insight");
    await seedMetric({ readiness: null, band: "calibrating" });

    const forced = await generateMorningInsight(USER, { force: true });
    expect(forced).not.toBe("skipped");
    if (forced === "skipped") throw new Error("unreachable");
    expect(forced.text).toContain("Calibrating — day 0 of 14 days");

    // Same-day guard still applies even when forced twice.
    expect(await generateMorningInsight(USER, { force: true })).toBe("skipped");
  });

  it("force:true names a same-day reading gap, not calibrating, for an already-calibrated athlete", async () => {
    const { db, schema } = await import("@/lib/db");
    const { generateMorningInsight } = await import("@/lib/morning-insight");
    // 14 days of real HRV/RHR history, ending yesterday — genuinely
    // calibrated — but no row at all for today.
    const today = new Date();
    await db.insert(schema.wellnessDaily).values(
      Array.from({ length: 14 }, (_, i) => {
        const d = new Date(today);
        d.setDate(d.getDate() - (14 - i));
        return { userId: USER, date: localYmd(d), hrvMs: 60, restingHr: 50 };
      })
    );
    // No seedMetric() call and no today wellness row → readiness null today.

    const forced = await generateMorningInsight(USER, { force: true });
    expect(forced).not.toBe("skipped");
    if (forced === "skipped") throw new Error("unreachable");
    expect(forced.text).toContain("Needs a readiness score today");
    expect(forced.text).not.toContain("Calibrating");
  });

  it("force:true posts a degraded brief when there is no daily_metrics row at all", async () => {
    const { generateMorningInsight } = await import("@/lib/morning-insight");
    // No seedMetric() call — zero rows for USER today.
    const forced = await generateMorningInsight(USER, { force: true });
    expect(forced).not.toBe("skipped");
    if (forced === "skipped") throw new Error("unreachable");
    expect(forced.text).toContain("Calibrating — day 0 of 14 days");
  });

  // Fix: the template's "Calibrating" sentence already says the picture is
  // incomplete — the completeness caveat must not repeat that same fact in
  // different words.
  it("suppresses the redundant caveat when the brief is already the calibrating line", async () => {
    const { generateMorningInsight } = await import("@/lib/morning-insight");
    // No seedMetric() and no wellness row → both "calibrating" (no
    // daily_metrics row) and "incomplete" (no wellness_daily row) are true.
    const forced = await generateMorningInsight(USER, { force: true });
    if (forced === "skipped") throw new Error("expected a brief");
    expect(forced.text).toContain("Calibrating — day 0 of 14 days");
    expect(forced.text).not.toContain("Incomplete picture");
  });

  it("force:false (default) still skips while calibrating, unchanged", async () => {
    const { generateMorningInsight } = await import("@/lib/morning-insight");
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
        availableBlocks: [
          {
            start: null,
            end: null,
            mins: 60,
            energy: "normal" as const,
            sports: null,
          },
        ],
        availableMins: 60,
        workouts: [],
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

  it("forced brief names the missing components and records dataComplete:false", async () => {
    const { db, schema } = await import("@/lib/db");
    const { generateMorningInsight } = await import("@/lib/morning-insight");
    // Scored on RHR + form only — exactly the 2026-07-26 failure shape.
    await db.insert(schema.dailyMetrics).values({
      userId: USER,
      date: localYmd(new Date()),
      readiness: 67,
      band: "green",
      tsb: 5,
      componentScores: { hrv: null, rhr: 71, sleep: null, form: 58 },
      hrvBaselineMean: Math.log(65),
      hrvBaselineSd: 0.1,
      rhrBaselineMean: 48,
      rhrBaselineSd: 2,
    });

    const r = await generateMorningInsight(USER, { force: true });
    if (r === "skipped") throw new Error("expected a brief");
    expect(r.text).toContain("Incomplete picture");
    expect(r.text).toContain("HRV");

    const msg = await db.query.chatMessages.findFirst({
      where: eq(schema.chatMessages.threadId, r.threadId),
    });
    expect(msg?.toolCalls).toMatchObject({ dataComplete: false });
  });

  it("a complete brief carries no caveat and records dataComplete:true", async () => {
    const { db, schema } = await import("@/lib/db");
    const { generateMorningInsight } = await import("@/lib/morning-insight");
    const today = localYmd(new Date());
    await db.insert(schema.wellnessDaily).values({
      userId: USER,
      date: today,
      hrvMs: 62,
      sleepSecs: 25000,
    });
    await db.insert(schema.dailyMetrics).values({
      userId: USER,
      date: today,
      readiness: 70,
      band: "green",
      tsb: 5,
      componentScores: { hrv: 55, rhr: 71, sleep: 68, form: 58 },
      hrvBaselineMean: Math.log(65),
      hrvBaselineSd: 0.1,
      rhrBaselineMean: 48,
      rhrBaselineSd: 2,
    });

    const r = await generateMorningInsight(USER);
    if (r === "skipped") throw new Error("expected a brief");
    expect(r.text).not.toContain("Incomplete picture");

    const msg = await db.query.chatMessages.findFirst({
      where: eq(schema.chatMessages.threadId, r.threadId),
    });
    expect(msg?.toolCalls).toMatchObject({ dataComplete: true });
  });

  it("passes the caveat to the LLM instruction too", async () => {
    const { db, schema } = await import("@/lib/db");
    const { generateMorningInsight } = await import("@/lib/morning-insight");
    await db.insert(schema.dailyMetrics).values({
      userId: USER,
      date: localYmd(new Date()),
      readiness: 67,
      band: "green",
      tsb: 5,
      componentScores: { hrv: null, rhr: 71, sleep: null, form: 58 },
      hrvBaselineMean: Math.log(65),
      hrvBaselineSd: 0.1,
      rhrBaselineMean: 48,
      rhrBaselineSd: 2,
    });

    let seen = "";
    await generateMorningInsight(USER, {
      force: true,
      llm: async (p) => {
        seen = p;
        return "Brief text";
      },
    });
    expect(seen).toContain("Incomplete picture");
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

  it("replaces an incomplete brief in place once the data completes", async () => {
    const { db, schema } = await import("@/lib/db");
    const { generateMorningInsight } = await import("@/lib/morning-insight");
    const today = localYmd(new Date());
    await db.insert(schema.dailyMetrics).values({
      userId: USER,
      date: today,
      readiness: 67,
      band: "green",
      tsb: 5,
      componentScores: { hrv: null, rhr: 71, sleep: null, form: 58 },
      hrvBaselineMean: Math.log(65),
      hrvBaselineSd: 0.1,
      rhrBaselineMean: 48,
      rhrBaselineSd: 2,
    });

    // 1. Backstop posts an incomplete brief.
    const first = await generateMorningInsight(USER, { force: true });
    if (first === "skipped") throw new Error("expected a brief");
    expect(first.text).toContain("Incomplete picture");

    // 2. The real overnight data lands and readiness is recomputed.
    await db.insert(schema.wellnessDaily).values({
      userId: USER,
      date: today,
      hrvMs: 62,
      sleepSecs: 25000,
    });
    await db
      .update(schema.dailyMetrics)
      .set({
        readiness: 58,
        band: "amber",
        componentScores: { hrv: 50, rhr: 71, sleep: 68, form: 58 },
      })
      .where(
        and(
          eq(schema.dailyMetrics.userId, USER),
          eq(schema.dailyMetrics.date, today)
        )
      );

    // 3. A normal (non-forced) trigger revises it.
    const second = await generateMorningInsight(USER);
    if (second === "skipped") throw new Error("expected a revision");
    expect(second.text).not.toContain("Incomplete picture");
    expect(second.text).toContain("58");

    // Exactly one message in the thread — replaced, not appended.
    const msgs = await db.query.chatMessages.findMany({
      where: eq(schema.chatMessages.threadId, first.threadId),
    });
    expect(msgs).toHaveLength(1);
    expect(msgs[0].toolCalls).toMatchObject({ dataComplete: true });

    // 4. A further trigger does not revise again.
    expect(await generateMorningInsight(USER)).toBe("skipped");
  });

  // Fix: the revision target must be today's newest *assistant brief*, not
  // the newest *message* in the thread. If the athlete replies to the
  // incomplete brief before the real data lands, that reply becomes the
  // newest message (toolCalls null) — the old code keyed revision off it and
  // gave up, leaving the wrong advice standing all day.
  it("revises today's brief even when the athlete replied in between", async () => {
    const { db, schema } = await import("@/lib/db");
    const { generateMorningInsight } = await import("@/lib/morning-insight");
    const today = localYmd(new Date());
    await db.insert(schema.dailyMetrics).values({
      userId: USER,
      date: today,
      readiness: 67,
      band: "green",
      tsb: 5,
      componentScores: { hrv: null, rhr: 71, sleep: null, form: 58 },
      hrvBaselineMean: Math.log(65),
      hrvBaselineSd: 0.1,
      rhrBaselineMean: 48,
      rhrBaselineSd: 2,
    });

    // 1. Backstop posts an incomplete brief.
    const first = await generateMorningInsight(USER, { force: true });
    if (first === "skipped") throw new Error("expected a brief");
    expect(first.text).toContain("Incomplete picture");

    const beforeReply = await db.query.chatMessages.findMany({
      where: eq(schema.chatMessages.threadId, first.threadId),
    });
    const briefId = beforeReply.find((m) => m.role === "assistant")!.id;

    // 2. The athlete replies to the incomplete brief before the real data
    // lands — this reply, not the brief, is now the newest thread message.
    await db.insert(schema.chatMessages).values({
      threadId: first.threadId,
      role: "user",
      content: "so should I still go hard?",
    });

    // 3. The real overnight data lands and readiness is recomputed.
    await db.insert(schema.wellnessDaily).values({
      userId: USER,
      date: today,
      hrvMs: 62,
      sleepSecs: 25000,
    });
    await db
      .update(schema.dailyMetrics)
      .set({
        readiness: 58,
        band: "amber",
        componentScores: { hrv: 50, rhr: 71, sleep: 68, form: 58 },
      })
      .where(
        and(
          eq(schema.dailyMetrics.userId, USER),
          eq(schema.dailyMetrics.date, today)
        )
      );

    // 4. A normal (non-forced) trigger must still revise the original brief.
    const second = await generateMorningInsight(USER);
    if (second === "skipped") throw new Error("expected a revision");
    expect(second.text).not.toContain("Incomplete picture");
    expect(second.text).toContain("58");

    const msgs = await db.query.chatMessages.findMany({
      where: eq(schema.chatMessages.threadId, first.threadId),
    });
    const assistantMsgs = msgs.filter((m) => m.role === "assistant");
    // Original brief row updated in place — same id, still exactly one
    // assistant brief in the thread alongside the athlete's untouched reply.
    expect(assistantMsgs).toHaveLength(1);
    expect(assistantMsgs[0].id).toBe(briefId);
    expect(assistantMsgs[0].toolCalls).toMatchObject({ dataComplete: true });
    expect(msgs).toHaveLength(2);
  });

  it("never revises a brief that was already complete", async () => {
    const { db, schema } = await import("@/lib/db");
    const { generateMorningInsight } = await import("@/lib/morning-insight");
    const today = localYmd(new Date());
    await db.insert(schema.wellnessDaily).values({
      userId: USER,
      date: today,
      hrvMs: 62,
      sleepSecs: 25000,
    });
    await db.insert(schema.dailyMetrics).values({
      userId: USER,
      date: today,
      readiness: 70,
      band: "green",
      tsb: 5,
      componentScores: { hrv: 55, rhr: 71, sleep: 68, form: 58 },
      hrvBaselineMean: Math.log(65),
      hrvBaselineSd: 0.1,
      rhrBaselineMean: 48,
      rhrBaselineSd: 2,
    });

    const first = await generateMorningInsight(USER);
    if (first === "skipped") throw new Error("expected a brief");
    expect(await generateMorningInsight(USER)).toBe("skipped");

    const msgs = await db.query.chatMessages.findMany({
      where: eq(schema.chatMessages.threadId, first.threadId),
    });
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toBe(first.text);
  });

  it("an incomplete brief stays put while the data is still incomplete", async () => {
    const { db, schema } = await import("@/lib/db");
    const { generateMorningInsight } = await import("@/lib/morning-insight");
    await db.insert(schema.dailyMetrics).values({
      userId: USER,
      date: localYmd(new Date()),
      readiness: 67,
      band: "green",
      tsb: 5,
      componentScores: { hrv: null, rhr: 71, sleep: null, form: 58 },
      hrvBaselineMean: Math.log(65),
      hrvBaselineSd: 0.1,
      rhrBaselineMean: 48,
      rhrBaselineSd: 2,
    });

    const first = await generateMorningInsight(USER, { force: true });
    if (first === "skipped") throw new Error("expected a brief");
    // No wellness row inserted — still incomplete.
    expect(await generateMorningInsight(USER, { force: true })).toBe("skipped");
  });

  // Fix: the morning thread is a live conversational thread, not an
  // append-only feed — production has seen 11+ messages land in a single
  // day. Today's brief is posted first (~05:00) and so is the *oldest* of
  // them; once more than 10 further messages land the same day, it falls
  // out of recentMessages()'s 10-row page entirely. Since that page used to
  // be the only place the revision target was found, the brief would
  // silently stop being revisable on any day chatty enough to push it out —
  // the same failure mode the previous fix addressed, just requiring more
  // conversation to trigger. todaysBrief() must query for the brief
  // directly instead of scanning the page.
  it("revises today's brief even when it has fallen out of the 10-row recent-messages window", async () => {
    const { db, schema } = await import("@/lib/db");
    const { generateMorningInsight } = await import("@/lib/morning-insight");
    const today = localYmd(new Date());
    await db.insert(schema.dailyMetrics).values({
      userId: USER,
      date: today,
      readiness: 67,
      band: "green",
      tsb: 5,
      componentScores: { hrv: null, rhr: 71, sleep: null, form: 58 },
      hrvBaselineMean: Math.log(65),
      hrvBaselineSd: 0.1,
      rhrBaselineMean: 48,
      rhrBaselineSd: 2,
    });

    // 1. Backstop posts an incomplete brief.
    const first = await generateMorningInsight(USER, { force: true });
    if (first === "skipped") throw new Error("expected a brief");
    expect(first.text).toContain("Incomplete picture");

    const briefRow = await db.query.chatMessages.findFirst({
      where: and(
        eq(schema.chatMessages.threadId, first.threadId),
        eq(schema.chatMessages.role, "assistant")
      ),
    });
    if (!briefRow) throw new Error("expected the brief row to exist");
    const briefId = briefRow.id;
    const briefCreatedAt = briefRow.createdAt;

    // 2. More than 10 further messages (athlete replies, in this case) land
    // in the thread the same day, each strictly newer than the brief —
    // pushing it well outside the 10 most recent rows.
    for (let i = 0; i < 11; i++) {
      await db.insert(schema.chatMessages).values({
        threadId: first.threadId,
        role: "user",
        content: `filler message ${i}`,
        createdAt: new Date(briefCreatedAt.getTime() + (i + 1) * 1000),
      });
    }

    // 3. The real overnight data lands and readiness is recomputed.
    await db.insert(schema.wellnessDaily).values({
      userId: USER,
      date: today,
      hrvMs: 62,
      sleepSecs: 25000,
    });
    await db
      .update(schema.dailyMetrics)
      .set({
        readiness: 58,
        band: "amber",
        componentScores: { hrv: 50, rhr: 71, sleep: 68, form: 58 },
      })
      .where(
        and(
          eq(schema.dailyMetrics.userId, USER),
          eq(schema.dailyMetrics.date, today)
        )
      );

    // 4. A normal (non-forced) trigger must still find and revise the
    // original brief in place, even though it's no longer among the 10 most
    // recent thread messages.
    const second = await generateMorningInsight(USER);
    if (second === "skipped") throw new Error("expected a revision");
    expect(second.text).not.toContain("Incomplete picture");
    expect(second.text).toContain("58");

    const msgs = await db.query.chatMessages.findMany({
      where: eq(schema.chatMessages.threadId, first.threadId),
    });
    const assistantMsgs = msgs.filter((m) => m.role === "assistant");
    // Updated in place — same row id, still exactly one assistant brief in
    // the thread, no second brief inserted alongside it.
    expect(assistantMsgs).toHaveLength(1);
    expect(assistantMsgs[0].id).toBe(briefId);
    expect(assistantMsgs[0].content).toBe(second.text);
    expect(assistantMsgs[0].toolCalls).toMatchObject({ dataComplete: true });
  });
});

// Task 12: race-day brief — the morning insight goes race-aware when a race
// with status="upcoming" lands on today's date.
describe.skipIf(!hasDb)("morning insight — race day (Task 12)", () => {
  const RACE_USER = "test-morning-insight-race-user";
  const RACE_USER_2 = "test-morning-insight-race-user-2";
  const RACE_USER_3 = "test-morning-insight-race-user-3";
  const RACE_USER_4 = "test-morning-insight-race-user-4";
  const RACE_USER_5 = "test-morning-insight-race-user-5";
  const RACE_USERS = [
    RACE_USER,
    RACE_USER_2,
    RACE_USER_3,
    RACE_USER_4,
    RACE_USER_5,
  ];

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
    await db
      .delete(schema.wellnessDaily)
      .where(eq(schema.wellnessDaily.userId, id));
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
      sport: "Run",
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

  it("race-day template names a same-day reading gap, not calibrating, for an already-calibrated athlete", async () => {
    const { db, schema } = await import("@/lib/db");
    const { createRace } = await import("@/lib/race/service");
    const { generateMorningInsight } = await import("@/lib/morning-insight");
    const today = localYmd(new Date());
    // 20 real HRV/RHR days, all 31–50 days ago — well clear of the 14-day
    // target, but also well outside a naive 14-day lookback window.
    const now = new Date();
    await db.insert(schema.wellnessDaily).values(
      Array.from({ length: 20 }, (_, i) => {
        const d = new Date(now);
        d.setDate(d.getDate() - (50 - i));
        return {
          userId: RACE_USER_5,
          date: localYmd(d),
          hrvMs: 60,
          restingHr: 50,
        };
      })
    );
    await createRace(RACE_USER_5, {
      name: "Fifth Race 10K",
      raceType: "10k",
      sport: "Run",
      date: today,
      priority: "B",
      goalNote: null,
    });
    // No daily_metrics row at all → no readiness computed today.

    const r = await generateMorningInsight(RACE_USER_5, {
      llm: async () => "", // empty LLM output → template fallback
    });
    expect(r).not.toBe("skipped");
    if (r === "skipped") throw new Error("expected a brief");
    expect(r.text).toContain("Needs a readiness score today");
    expect(r.text).not.toContain("Calibrating");
  });

  it("race-day template fallback names the race", async () => {
    // Second same-day call is guarded; use a second user for the template path.
    const { createRace } = await import("@/lib/race/service");
    const { generateMorningInsight } = await import("@/lib/morning-insight");
    const today = localYmd(new Date());
    await createRace(RACE_USER_2, {
      name: "Second City 10K",
      raceType: "10k",
      sport: "Run",
      date: today,
      priority: "B",
      goalNote: null,
    });

    const r = await generateMorningInsight(RACE_USER_2, {
      llm: async () => "", // empty LLM output → template fallback
    });
    expect(r).not.toBe("skipped");
    // RACE_USER_2 has no wellness_daily/daily_metrics rows at all today, so
    // the completeness caveat (2026-07-26) applies here too — but it is now
    // woven in *after* the race lead-in (Fix), not prepended ahead of it, so
    // the stronger assertion is restored: the text must actually start with
    // the race line.
    if (r !== "skipped") expect(r.text).toMatch(/^Race day: /);
    if (r !== "skipped") expect(r.text).toContain("Race day: Second City 10K");
  });

  // Fix: the caveat must be woven in after the race lead-in, never ahead of
  // it — "lead with the race" has to be true of the rendered text on the
  // highest-stakes brief of the athlete's season.
  it("race day: the incomplete-data caveat appears after the race lead-in, not before it", async () => {
    const { createRace } = await import("@/lib/race/service");
    const { generateMorningInsight } = await import("@/lib/morning-insight");
    const today = localYmd(new Date());
    await createRace(RACE_USER_4, {
      name: "Fourth Race 5K",
      raceType: "5k",
      sport: "Run",
      date: today,
      priority: "B",
      goalNote: null,
    });

    // No wellness_daily/daily_metrics rows at all → both calibrating and
    // incomplete, so the caveat definitely fires.
    const r = await generateMorningInsight(RACE_USER_4, {
      llm: async () => "", // empty LLM output → template fallback
    });
    expect(r).not.toBe("skipped");
    if (r === "skipped") throw new Error("expected a brief");
    expect(r.text).toMatch(
      /^Race day: Fourth Race 5K \(B race\)\. Incomplete picture/
    );
    const leadIdx = r.text.indexOf("Race day:");
    const caveatIdx = r.text.indexOf("Incomplete picture");
    expect(leadIdx).toBe(0);
    expect(caveatIdx).toBeGreaterThan(leadIdx);
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
      sport: "Run",
      date: today,
      priority: "C",
      goalNote: null,
    });
    // Yesterday's stored ctl/atl — the projection is a pure decay step and
    // no longer looks at yesterday's planned/actual load at all (Fix 4).
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
    // Pure decay: pCtl = 50*(1-1/42) = 50*41/42 ≈ 48.8095;
    // pAtl = 40*(1-1/7) = 40*6/7 ≈ 34.2857
    // projected = round((pCtl-pAtl)*10)/10 = 14.5; actual = round(8*10)/10 = 8
    expect(seenInstruction).toContain("Projected TSB 14.5 vs actual 8");
  });
});
