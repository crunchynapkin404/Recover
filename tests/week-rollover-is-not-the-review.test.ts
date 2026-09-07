/**
 * The week must roll over on Monday whether or not there is a review to write.
 *
 * Reported by the athlete on Monday 2026-09-07: "today is monday. and the week
 * is still on last week in train."
 *
 * The rollover — closing last week and materializing this one — was reachable
 * from exactly four places: creating a plan, confirming a plan, the
 * "Plan this week" button, and the LAST STEP of `generateWeeklyReview`. Only
 * the last of those is automatic, and it sits behind two early returns that
 * have nothing to do with the calendar:
 *
 *   1. the at-most-once-per-cycle guard. On Monday before the configured
 *      review hour (notification_prefs default 07:00), `mostRecentSlot`
 *      resolves to LAST Monday, so last week's own review message satisfies
 *      `latest.createdAt >= slot` and the function returns. Every Monday, for
 *      seven hours, by construction.
 *   2. the "<3 non-Strava activities in 7 days" guard, which returns for an
 *      athlete who simply trains less than that — permanently.
 *      scheduler.ts's own comment notes this guard "never advances" for them.
 *
 * `getOpenWeekPlan` selects on `status = 'open'` with no date filter, so a
 * week that never closed keeps rendering as the current one — and
 * `train/page.tsx` hides the "Plan this week" button whenever an open week
 * exists, which is exactly when a stale one is showing. There was no way out
 * from inside the app.
 *
 * So this asserts the calendar on its own terms: a scheduler pass at 06:00,
 * an hour where the review is not attempted at all — runMorningBriefBackstop
 * returns outright below BACKSTOP_HOUR, and 06:00 is before the 07:00 slot
 * besides — must still leave the athlete on this week. Nothing here can pass
 * by way of a review, which is the whole point.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { mondayOf, addDaysYmd } from "@/lib/week-plan/service";

const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

const USER = "test-rollover-not-the-review";

// Relative to today, never pinned: this file would otherwise expire the way
// the nine in docs/2026-09-06-calendar-dependent-fixtures.md did.
const THIS_MONDAY = mondayOf(new Date());
const LAST_MONDAY = addDaysYmd(THIS_MONDAY, -7);

/**
 * This Monday at 06:00 — before BACKSTOP_HOUR (9), which is where
 * runMorningBriefBackstop returns outright, and before the 07:00 review slot.
 * Nothing in this test can pass by way of a review, which is the point.
 */
function mondayEarly(): Date {
  return new Date(`${THIS_MONDAY}T06:00:00`);
}

function emptyDays(weekStart: string) {
  return Array.from({ length: 7 }, (_, i) => ({
    date: addDaysYmd(weekStart, i),
    availableBlocks: [
      { start: null, end: null, mins: 90, energy: "normal", sports: null },
    ],
    availableMins: 90,
    workouts: [],
    status: "rest" as const,
  }));
}

async function cleanup() {
  const { db, schema } = await import("@/lib/db");
  await db.delete(schema.weekPlans).where(eq(schema.weekPlans.userId, USER));
  await db
    .delete(schema.trainingPlans)
    .where(eq(schema.trainingPlans.userId, USER));
  await db
    .delete(schema.availabilityDefaults)
    .where(eq(schema.availabilityDefaults.userId, USER));
  await db
    .delete(schema.connections)
    .where(eq(schema.connections.userId, USER));
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
  await db.delete(schema.users).where(eq(schema.users.id, USER));
}

describe.skipIf(!hasDb)("the week rolls over without a review", () => {
  beforeAll(async () => {
    await cleanup();
    const { db, schema } = await import("@/lib/db");
    const { encrypt } = await import("@/lib/crypto");

    await db.insert(schema.users).values({
      id: USER,
      name: "Rollover",
      email: `${USER}@example.invalid`,
    });
    // Not what selects this user — runWeekRollovers keys on the ACTIVE PLAN,
    // so a manual-only athlete still gets a Monday. Seeded because a real
    // athlete in this state has one, and the passes around it read them.
    await db.insert(schema.connections).values({
      userId: USER,
      provider: "intervals_icu",
      encryptedAccessToken: encrypt("fake-key"),
      externalAthleteId: "i-rollover",
      status: "active",
    });

    const [plan] = await db
      .insert(schema.trainingPlans)
      .values({
        userId: USER,
        title: "Rollover plan",
        raceType: "marathon",
        raceDate: addDaysYmd(THIS_MONDAY, 12 * 7),
        startDate: LAST_MONDAY,
        weeksTotal: 12,
        currentWeek: 1,
        status: "active",
        constraints: { daysPerWeek: 5, hoursPerWeek: 8, sports: ["Run"] },
      })
      .returning();

    await db.insert(schema.trainingBlocks).values({
      planId: plan.id,
      weekNumber: 1,
      phase: "build",
      targetLoadTotal: 400,
      targetSessions: 5,
      workouts: [],
    });

    // The rollover resolves availability from availability_defaults.
    await db.insert(schema.availabilityDefaults).values(
      Array.from({ length: 7 }, (_, weekday) => ({
        userId: USER,
        weekday,
        blocks: [
          {
            start: null,
            end: null,
            mins: 90,
            energy: "normal" as const,
            sports: null,
          },
        ],
      }))
    );

    // LAST week's plan, still open — the state the athlete was looking at.
    await db.insert(schema.weekPlans).values({
      userId: USER,
      planId: plan.id,
      weekStart: LAST_MONDAY,
      skeletonWeek: 1,
      days: emptyDays(LAST_MONDAY),
      status: "open",
      effectiveTarget: 400,
    });
  });

  afterAll(cleanup);

  it("a Monday scheduler pass before the review hour still moves the athlete on", async () => {
    const { getOpenWeekPlan } = await import("@/lib/week-plan/service");
    const { runWeekRollovers } = await import("@/lib/sync/scheduler");

    const before = await getOpenWeekPlan(USER);
    expect(before?.weekStart).toBe(LAST_MONDAY);

    expect(await runWeekRollovers(mondayEarly(), { userIds: [USER] })).toBe(1);

    const after = await getOpenWeekPlan(USER);
    expect(after?.weekStart).toBe(THIS_MONDAY);
  });

  it("closes the week it left behind rather than leaving two open", async () => {
    const { db, schema } = await import("@/lib/db");
    const rows = await db.query.weekPlans.findMany({
      where: eq(schema.weekPlans.userId, USER),
    });
    const open = rows.filter((r) => r.status === "open");
    expect(open).toHaveLength(1);
    expect(open[0].weekStart).toBe(THIS_MONDAY);
    expect(rows.find((r) => r.weekStart === LAST_MONDAY)?.status).toBe(
      "closed"
    );
  });
});
