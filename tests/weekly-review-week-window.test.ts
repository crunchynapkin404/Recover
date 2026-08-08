import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { mondayOf, addDaysYmd } from "@/lib/week-plan/service";

// No database: this pins the window arithmetic the review must use, which
// is the part that was wrong. The end-to-end agreement with rollover is
// covered by the DB-gated test below it.
describe("the review's week window", () => {
  it("is the calendar week that just closed", () => {
    // A Wednesday. The week under review is the PREVIOUS Mon-Sun.
    const now = new Date("2026-08-05T04:00:00");
    const weekStart = addDaysYmd(mondayOf(now), -7);
    const weekEnd = addDaysYmd(weekStart, 6);
    expect(weekStart).toBe("2026-07-27");
    expect(weekEnd).toBe("2026-08-02");
  });

  it("spans exactly 6 days start-to-end (7 days inclusive), from any day of the week", () => {
    for (let i = 0; i < 7; i++) {
      const now = new Date(`2026-08-0${3 + i}T04:00:00`);
      const weekStart = addDaysYmd(mondayOf(now), -7);
      const weekEnd = addDaysYmd(weekStart, 6);
      // A string comparison (weekEnd > weekStart) would pass for ANY
      // positive offset, not specifically 6 — measure the actual span in
      // milliseconds instead, so a quietly-shortened or -lengthened
      // window (e.g. 1 or 3 days) fails this assertion.
      const spanDays =
        (new Date(weekEnd + "T00:00:00").getTime() -
          new Date(weekStart + "T00:00:00").getTime()) /
        (24 * 60 * 60 * 1000);
      expect(spanDays).toBe(6);
      expect(new Date(weekStart + "T00:00:00").getDay()).toBe(1); // Monday
    }
  });
});

// ── DB-gated: the athlete-facing agreement test ─────────────────────────────
//
// Runs against the SAME database as the live app — there is no separate test
// database in this environment. Every row seeded below carries the fake id
// USER, and every query is scoped by it, so this can never touch a real
// user's rows.
const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

const USER = "test-weekly-review-window-user";

function localYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

describe.skipIf(!hasDb)("review and rollover agree on the week", () => {
  let planId: string;
  const now = new Date();
  // The exact window generateWeeklyReview computes for "now" — same
  // functions, same inputs, so this cannot drift from the code under test.
  const weekStart = addDaysYmd(mondayOf(now), -7);
  const dates = Array.from({ length: 7 }, (_, i) => addDaysYmd(weekStart, i));

  function emptyDay(date: string) {
    return {
      date,
      availableBlocks: [
        {
          start: null,
          end: null,
          mins: 120,
          energy: "full" as const,
          sports: null,
        },
      ],
      availableMins: 120,
      workouts: [],
      status: "rest" as const,
    };
  }

  async function addActivity(opts: {
    externalId: string;
    ymd: string;
    load: number;
    provider?: "intervals_icu" | "strava";
  }) {
    const { db, schema } = await import("@/lib/db");
    const { externalId, ymd, load, provider = "intervals_icu" } = opts;
    await db.insert(schema.activities).values({
      userId: USER,
      provider,
      externalId,
      startDate: new Date(`${ymd}T09:00:00`),
      startDateLocal: new Date(`${ymd}T09:00:00`),
      sport: "Ride",
      durationS: 3600,
      load,
    });
  }

  // Three "recent" filler activities, purely to clear generateWeeklyReview's
  // "did anything happen in the last 7 days" skip gate. That gate windows
  // off raw `now`, not the calendar week under review, so these are dated
  // today — outside [weekStart, weekEnd] and irrelevant to the reported
  // number.
  async function seedGuardFillers() {
    const today = localYmd(now);
    for (let i = 0; i < 3; i++) {
      await addActivity({
        externalId: `${USER}-filler-${i}`,
        ymd: today,
        load: 5,
      });
    }
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
    await db.delete(schema.weekPlans).where(eq(schema.weekPlans.userId, USER));
    // Cascades to training_blocks (training_blocks.plan_id → training_plans.id
    // ON DELETE CASCADE) and plan_adjustments transitively via week_plans.
    await db
      .delete(schema.trainingPlans)
      .where(eq(schema.trainingPlans.userId, USER));
    await db
      .delete(schema.notificationPrefs)
      .where(eq(schema.notificationPrefs.userId, USER));
    await db.delete(schema.users).where(eq(schema.users.id, USER));
  }

  beforeAll(async () => {
    await cleanup();
    const { db, schema } = await import("@/lib/db");

    await db.insert(schema.users).values({
      id: USER,
      name: "Weekly Review Window Test",
      email: `${USER}@example.invalid`,
      role: "member",
    });

    // Prefs set so "now" is past the review slot — the due-since-slot guard
    // then treats the review as due, same idiom as tests/weekly-review.test.ts.
    await db.insert(schema.notificationPrefs).values({
      userId: USER,
      weeklyReviewDay: now.getDay(),
      weeklyReviewHour: now.getHours(),
    });

    const [plan] = await db
      .insert(schema.trainingPlans)
      .values({
        userId: USER,
        title: "Test Rollover Plan",
        raceType: "gran_fondo",
        raceDate: "2026-09-13",
        startDate: weekStart,
        weeksTotal: 8,
        currentWeek: 1,
        status: "active",
        // rolloverWeekPlan reads constraints.sports itself once it moves
        // past the close loop to materialize next week — omitting it throws
        // requirePlanSport's "unsupported plan sport: undefined". Same shape
        // tests/week-actuals-booking.test.ts uses for its own rollover fixture.
        constraints: { daysPerWeek: 3, hoursPerWeek: 6, sports: ["Bike"] },
      })
      .returning();
    planId = plan.id;

    await db.insert(schema.trainingBlocks).values([
      {
        planId,
        weekNumber: 1,
        phase: "base",
        targetLoadTotal: 244,
        targetSessions: 3,
        workouts: [],
      },
      {
        planId,
        weekNumber: 2,
        phase: "base",
        targetLoadTotal: 260,
        targetSessions: 3,
        workouts: [],
      },
    ]);
  });

  afterAll(cleanup);

  beforeEach(async () => {
    const { db, schema } = await import("@/lib/db");
    await db
      .delete(schema.activities)
      .where(eq(schema.activities.userId, USER));
    // rolloverWeekPlan flips the closing week to "closed" and inserts next
    // week's row — reset to a single fresh "open" fixture before every test.
    await db.delete(schema.weekPlans).where(eq(schema.weekPlans.userId, USER));
    await db.insert(schema.weekPlans).values({
      userId: USER,
      planId,
      weekStart,
      skeletonWeek: 1,
      days: dates.map(emptyDay),
      status: "open",
      effectiveTarget: 244,
    });
    // Undo the currentWeek advance a previous test's review pass made.
    await db
      .update(schema.trainingPlans)
      .set({ currentWeek: 1 })
      .where(eq(schema.trainingPlans.id, planId));
    // Clear any thread/messages so "the latest message" read below is
    // unambiguous.
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

  it("reports the same load rolloverWeekPlan stores for the week", async () => {
    await seedGuardFillers();
    // The two activities that make up the reported week load: 120 + 130.
    await addActivity({ externalId: `${USER}-mon`, ymd: weekStart, load: 120 });
    await addActivity({
      externalId: `${USER}-wed`,
      ymd: addDaysYmd(weekStart, 2),
      load: 130,
    });

    const { db, schema } = await import("@/lib/db");
    const { generateWeeklyReview } = await import("@/lib/weekly-review");
    await generateWeeklyReview(USER);

    // ── The athlete-facing number, read back from chat_messages ──────────
    const thread = await db.query.chatThreads.findFirst({
      where: and(
        eq(schema.chatThreads.userId, USER),
        eq(schema.chatThreads.kind, "weekly")
      ),
    });
    expect(thread).toBeDefined();
    const msg = await db.query.chatMessages.findFirst({
      where: eq(schema.chatMessages.threadId, thread!.id),
    });
    expect(msg).toBeDefined();
    const match = msg!.content.match(/review: (\d+) load/);
    expect(match).not.toBeNull();
    const messageLoad = Number(match![1]);

    // ── The number the database ends up holding for the same week ────────
    const block = await db.query.trainingBlocks.findFirst({
      where: and(
        eq(schema.trainingBlocks.planId, planId),
        eq(schema.trainingBlocks.weekNumber, 1)
      ),
    });
    expect(block).toBeDefined();
    expect(block!.actualLoad).not.toBeNull();

    // THE assertion this task exists for: the message's number and the
    // stored number must be the SAME number, asserted directly against each
    // other — not two separate checks against an expected constant that
    // could each pass while the two diverge from one another.
    expect(messageLoad).toBe(block!.actualLoad);

    // Sanity: it's also the value both routes should independently produce.
    expect(messageLoad).toBe(250);
  });

  it("never counts a Strava-sourced activity in either number", async () => {
    await seedGuardFillers();
    // One legitimate activity plus one Strava-sourced activity in the same
    // week, with a load large enough that counting it would be obvious:
    // 100 + 5000 = 5100 ≠ 100. Strava data must never reach an AI surface
    // (Nov 2024 API agreement) — the weekly review message is one.
    await addActivity({
      externalId: `${USER}-legit`,
      ymd: weekStart,
      load: 100,
    });
    await addActivity({
      externalId: `${USER}-strava`,
      ymd: addDaysYmd(weekStart, 1),
      load: 5000,
      provider: "strava",
    });

    const { db, schema } = await import("@/lib/db");
    const { generateWeeklyReview } = await import("@/lib/weekly-review");
    await generateWeeklyReview(USER);

    const thread = await db.query.chatThreads.findFirst({
      where: and(
        eq(schema.chatThreads.userId, USER),
        eq(schema.chatThreads.kind, "weekly")
      ),
    });
    const msg = await db.query.chatMessages.findFirst({
      where: eq(schema.chatMessages.threadId, thread!.id),
    });
    const match = msg!.content.match(/review: (\d+) load/);
    const messageLoad = Number(match![1]);

    const block = await db.query.trainingBlocks.findFirst({
      where: and(
        eq(schema.trainingBlocks.planId, planId),
        eq(schema.trainingBlocks.weekNumber, 1)
      ),
    });

    expect(messageLoad).toBe(100);
    expect(block!.actualLoad).toBe(100);
    // Restated explicitly: neither figure is the Strava-inflated total.
    expect(messageLoad).not.toBe(5100);
    expect(block!.actualLoad).not.toBe(5100);
  });
});
