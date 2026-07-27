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
    // monthly-report.test.ts / weekly-review.test.ts for this identical
    // query shape (morning-insight.test.ts's equivalent query is userId-only,
    // not kind-scoped — it doesn't have sibling thread kinds to race against).
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

  // Fix 2: generateWeeklyReview/generateMonthlyReport both create their
  // thread (findOrCreateWeeklyThread/findOrCreateMonthlyThread) before
  // bailing out on insufficient data — USER has no activities, so thread
  // existence is a direct proxy for "was the re-check called at all".
  it("does not re-check weekly/monthly review outside the top-of-hour window", async () => {
    const { runMorningBriefBackstop } = await import("@/lib/sync/scheduler");
    const { db, schema } = await import("@/lib/db");
    const midHour = new Date();
    midHour.setHours(9, 30, 0, 0); // past BACKSTOP_HOUR, outside the first 5 min

    await runMorningBriefBackstop(midHour, { userIds: [USER] });

    const weeklyThread = await db.query.chatThreads.findFirst({
      where: and(
        eq(schema.chatThreads.userId, USER),
        eq(schema.chatThreads.kind, "weekly")
      ),
    });
    const monthlyThread = await db.query.chatThreads.findFirst({
      where: and(
        eq(schema.chatThreads.userId, USER),
        eq(schema.chatThreads.kind, "monthly")
      ),
    });
    expect(weeklyThread).toBeUndefined();
    expect(monthlyThread).toBeUndefined();
  });

  it("does re-check weekly/monthly review inside the top-of-hour window", async () => {
    const { runMorningBriefBackstop } = await import("@/lib/sync/scheduler");
    const { db, schema } = await import("@/lib/db");
    const topOfHour = new Date();
    topOfHour.setHours(9, 2, 0, 0); // inside the first 5 min past BACKSTOP_HOUR

    await runMorningBriefBackstop(topOfHour, { userIds: [USER] });

    const weeklyThread = await db.query.chatThreads.findFirst({
      where: and(
        eq(schema.chatThreads.userId, USER),
        eq(schema.chatThreads.kind, "weekly")
      ),
    });
    const monthlyThread = await db.query.chatThreads.findFirst({
      where: and(
        eq(schema.chatThreads.userId, USER),
        eq(schema.chatThreads.kind, "monthly")
      ),
    });
    expect(weeklyThread).not.toBeUndefined();
    expect(monthlyThread).not.toBeUndefined();
  });
});

// Fix 1 (CRITICAL) regression: onWellnessDataChanged unconditionally re-runs
// runDailyAdaptation, and adaptDay's red/amber band branch has no "already
// adapted" guard (src/lib/week-plan/adapt-day.ts:184-185) — calling it again
// re-scales the already-scaled stored duration every time (AMBER_SCALE 0.85:
// 90 -> 77 -> 65 -> ... every tick past the backstop hour). The fix makes
// runMorningBriefBackstop skip a user's onWellnessDataChanged call entirely
// once getLatestMorningInsight shows today's brief already exists. Exercised
// against a dedicated user + week plan so it doesn't interact with the
// fixture above.
function localYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function mondayOf(d: Date): string {
  const day = (d.getDay() + 6) % 7; // Mon=0
  const m = new Date(d);
  m.setDate(d.getDate() - day);
  return localYmd(m);
}
function addDaysYmd(ymd: string, n: number): string {
  const d = new Date(ymd + "T00:00:00");
  d.setDate(d.getDate() + n);
  return localYmd(d);
}

describe.skipIf(!hasDb)(
  "runMorningBriefBackstop — does not re-adapt once today's brief exists (Fix 1)",
  () => {
    const ADAPT_USER = "test-morning-backstop-adapt-user";
    const weekStart = mondayOf(new Date());
    const todayYmd = localYmd(new Date());
    let planId: string;

    async function cleanupAdaptUser() {
      const { db, schema } = await import("@/lib/db");
      // weekPlans/trainingBlocks/trainingPlans/connections/dailyMetrics/
      // chatThreads (+messages cascade) all reference users.id ON DELETE
      // CASCADE — deleting the user is sufficient, same idiom as
      // tests/week-plans.test.ts's cleanupUsers.
      await db.delete(schema.users).where(eq(schema.users.id, ADAPT_USER));
    }

    beforeAll(async () => {
      await cleanupAdaptUser();
      const { db, schema } = await import("@/lib/db");
      const { encrypt } = await import("@/lib/crypto");
      await db
        .insert(schema.users)
        .values({
          id: ADAPT_USER,
          name: "Backstop Adapt",
          email: "backstop-adapt@example.invalid",
        })
        .onConflictDoNothing();
      await db.insert(schema.connections).values({
        userId: ADAPT_USER,
        provider: "intervals_icu",
        encryptedAccessToken: encrypt("fake-key"),
        externalAthleteId: "i-backstop-adapt",
        status: "active",
      });
      const [plan] = await db
        .insert(schema.trainingPlans)
        .values({
          userId: ADAPT_USER,
          title: "Backstop adapt test plan",
          raceType: "marathon",
          raceDate: addDaysYmd(weekStart, 12 * 7),
          startDate: weekStart,
          weeksTotal: 12,
          currentWeek: 1,
          status: "active",
          constraints: { daysPerWeek: 5, hoursPerWeek: 8, sports: ["Run"] },
        })
        .returning();
      planId = plan.id;
      await db.insert(schema.trainingBlocks).values({
        planId,
        weekNumber: 1,
        phase: "build",
        targetLoadTotal: 400,
        targetSessions: 5,
        workouts: [],
      });
      // Amber band + a 90-min Endurance day today — the exact shape the
      // CRITICAL finding described (AMBER_SCALE 0.85: 90 -> 77 -> 65 -> ...
      // on repeat calls, absent the fix).
      await db.insert(schema.dailyMetrics).values({
        userId: ADAPT_USER,
        date: todayYmd,
        readiness: 55,
        band: "amber",
      });
    });

    afterAll(cleanupAdaptUser);

    beforeEach(async () => {
      const { db, schema } = await import("@/lib/db");
      const threads = await db.query.chatThreads.findMany({
        where: eq(schema.chatThreads.userId, ADAPT_USER),
      });
      for (const t of threads) {
        await db
          .delete(schema.chatMessages)
          .where(eq(schema.chatMessages.threadId, t.id));
      }
      await db
        .delete(schema.chatThreads)
        .where(eq(schema.chatThreads.userId, ADAPT_USER));
      // Reset to a fresh, un-adapted week plan before each test.
      await db
        .delete(schema.weekPlans)
        .where(eq(schema.weekPlans.userId, ADAPT_USER));
      await db.insert(schema.weekPlans).values({
        userId: ADAPT_USER,
        planId,
        weekStart,
        skeletonWeek: 1,
        days: Array.from({ length: 7 }, (_, i) => {
          const date = addDaysYmd(weekStart, i);
          if (date === todayYmd) {
            return {
              date,
              availableBlocks: [
                {
                  start: null,
                  end: null,
                  mins: 120,
                  energy: "normal" as const,
                  sports: null,
                },
              ],
              availableMins: 120,
              workouts: [
                {
                  day: i,
                  sport: "Run",
                  type: "Endurance",
                  durationMins: 90,
                  intensity: "Z2",
                  description: "Long run",
                  blockIdx: 0,
                },
              ],
              status: "planned" as const,
            };
          }
          return {
            date,
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
            status: "rest" as const,
          };
        }),
        status: "open",
      });
    });

    it("scales today's workout once, then leaves it alone on a repeat tick the same morning", async () => {
      const { runMorningBriefBackstop } = await import("@/lib/sync/scheduler");
      const { getOpenWeekPlan, listAdjustments } =
        await import("@/lib/week-plan/service");

      const firstTick = new Date();
      firstTick.setHours(9, 15, 0, 0);
      const first = await runMorningBriefBackstop(firstTick, {
        userIds: [ADAPT_USER],
      });
      expect(first).toBe(1);

      const afterFirst = await getOpenWeekPlan(ADAPT_USER);
      const dayAfterFirst = afterFirst!.days.find((d) => d.date === todayYmd);
      // amber: round(90 * 0.85) = 77 — the one legitimate adaptation.
      expect(dayAfterFirst?.workouts[0]?.durationMins).toBe(77);
      const adjustmentsAfterFirst = await listAdjustments(afterFirst!.id);
      expect(
        adjustmentsAfterFirst.filter((a) => a.trigger === "low_readiness")
      ).toHaveLength(1);

      // A second tick a minute later, same morning: today's brief already
      // exists, so the whole onWellnessDataChanged call (and therefore
      // runDailyAdaptation) must be skipped entirely. Before Fix 1, this
      // unconditionally re-ran adaptDay and rescaled 77 -> round(77*0.85) = 65.
      const secondTick = new Date();
      secondTick.setHours(9, 16, 0, 0);
      const second = await runMorningBriefBackstop(secondTick, {
        userIds: [ADAPT_USER],
      });
      expect(second).toBe(0);

      const afterSecond = await getOpenWeekPlan(ADAPT_USER);
      const dayAfterSecond = afterSecond!.days.find((d) => d.date === todayYmd);
      expect(dayAfterSecond?.workouts[0]?.durationMins).toBe(77);
      const adjustmentsAfterSecond = await listAdjustments(afterSecond!.id);
      expect(
        adjustmentsAfterSecond.filter((a) => a.trigger === "low_readiness")
      ).toHaveLength(1);
    });
  }
);
