/**
 * A week that does not contain today must never render as if it did.
 *
 * This is the READ half of the Monday defect. The write half — the rollover
 * running only as the last step of generateWeeklyReview — is fixed by
 * runWeekRollovers, so in normal operation the week is current within a tick.
 * But `getOpenWeekPlan` selects on `status = 'open'` with NO date filter, so if
 * the rollover is ever prevented again the athlete is shown last week's grid,
 * labelled as this week, with nothing anywhere saying so. That is what made the
 * original report ("today is monday. and the week is still on last week in
 * train") a surprise rather than a message.
 *
 * The page already has the right state for "no current week": the
 * "Plan this week" form, wired to the idempotent rollover. It was simply
 * unreachable, because a stale row is still a truthy row. Reaching it turns the
 * worst case from *silently wrong* into *visibly fixable*.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { renderToReadableStream } from "react-dom/server";
import { mondayOf, addDaysYmd } from "@/lib/week-plan/service";
import { formatDayRange } from "@/lib/format";
import type { DaySlot } from "@/lib/week-plan/types";

vi.mock("next/navigation", () => ({
  usePathname: () => "/train",
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

const { requireUserMock } = vi.hoisted(() => ({ requireUserMock: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireUser: requireUserMock }));

const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

const USER = "test-train-stale-week";

// Relative to today, never pinned.
const THIS_MONDAY = mondayOf(new Date());
const LAST_MONDAY = addDaysYmd(THIS_MONDAY, -7);

function emptyDay(date: string): DaySlot {
  return {
    date,
    availableBlocks: [
      { start: null, end: null, mins: 90, energy: "normal", sports: null },
    ],
    availableMins: 90,
    workouts: [],
    status: "rest",
  };
}

async function renderTrain(): Promise<string> {
  requireUserMock.mockResolvedValue({
    id: USER,
    email: `${USER}@example.invalid`,
    name: "Stale Week",
  });
  const { default: TrainPage } = await import("./page");
  const stream = await renderToReadableStream(
    <TrainPage searchParams={Promise.resolve({})} />
  );
  await stream.allReady;
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let html = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    html += decoder.decode(value, { stream: true });
  }
  return html;
}

async function cleanup() {
  const { db, schema } = await import("@/lib/db");
  await db.delete(schema.weekPlans).where(eq(schema.weekPlans.userId, USER));
  await db
    .delete(schema.trainingPlans)
    .where(eq(schema.trainingPlans.userId, USER));
  await db.delete(schema.users).where(eq(schema.users.id, USER));
}

describe.skipIf(!hasDb)("Train with a week that has gone stale", () => {
  beforeAll(async () => {
    await cleanup();
    const { db, schema } = await import("@/lib/db");
    await db.insert(schema.users).values({
      id: USER,
      name: "Stale Week",
      email: `${USER}@example.invalid`,
    });
    const [plan] = await db
      .insert(schema.trainingPlans)
      .values({
        userId: USER,
        title: "Stale plan",
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
    // The state the athlete met: LAST week, still open.
    await db.insert(schema.weekPlans).values({
      userId: USER,
      planId: plan.id,
      weekStart: LAST_MONDAY,
      skeletonWeek: 1,
      days: Array.from({ length: 7 }, (_, i) =>
        emptyDay(addDaysYmd(LAST_MONDAY, i))
      ),
      status: "open",
      effectiveTarget: 400,
    });
  });

  afterAll(cleanup);

  it("does not draw last week's days as this week", async () => {
    const html = await renderTrain();
    // The day strip renders one `data-date` per day of the week it is showing.
    for (let i = 0; i < 7; i++) {
      const stale = addDaysYmd(LAST_MONDAY, i);
      expect(
        html.includes(`data-date="${stale}"`),
        `rendered ${stale}, which is last week`
      ).toBe(false);
    }
  });

  it("offers the way out instead", async () => {
    const html = await renderTrain();
    // The existing empty state, unreachable until now because a stale row is
    // still a truthy row.
    expect(html).toContain("Plan this week");
  });
});

const CURRENT_USER = "test-train-current-week";

async function renderTrainAs(userId: string): Promise<string> {
  requireUserMock.mockResolvedValue({
    id: userId,
    email: `${userId}@example.invalid`,
    name: "Current Week",
  });
  const { default: TrainPage } = await import("./page");
  const stream = await renderToReadableStream(
    <TrainPage searchParams={Promise.resolve({})} />
  );
  await stream.allReady;
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let html = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    html += decoder.decode(value, { stream: true });
  }
  return html;
}

describe.skipIf(!hasDb)("Train says which seven days it is showing", () => {
  beforeAll(async () => {
    const { db, schema } = await import("@/lib/db");
    await db
      .delete(schema.weekPlans)
      .where(eq(schema.weekPlans.userId, CURRENT_USER));
    await db
      .delete(schema.trainingPlans)
      .where(eq(schema.trainingPlans.userId, CURRENT_USER));
    await db.delete(schema.users).where(eq(schema.users.id, CURRENT_USER));
    await db.insert(schema.users).values({
      id: CURRENT_USER,
      name: "Current Week",
      email: `${CURRENT_USER}@example.invalid`,
    });
    const [plan] = await db
      .insert(schema.trainingPlans)
      .values({
        userId: CURRENT_USER,
        title: "Current plan",
        raceType: "marathon",
        raceDate: addDaysYmd(THIS_MONDAY, 12 * 7),
        startDate: THIS_MONDAY,
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
    await db.insert(schema.weekPlans).values({
      userId: CURRENT_USER,
      planId: plan.id,
      weekStart: THIS_MONDAY,
      skeletonWeek: 1,
      days: Array.from({ length: 7 }, (_, i) =>
        emptyDay(addDaysYmd(THIS_MONDAY, i))
      ),
      status: "open",
      effectiveTarget: 400,
    });
  });

  afterAll(async () => {
    const { db, schema } = await import("@/lib/db");
    await db
      .delete(schema.weekPlans)
      .where(eq(schema.weekPlans.userId, CURRENT_USER));
    await db
      .delete(schema.trainingPlans)
      .where(eq(schema.trainingPlans.userId, CURRENT_USER));
    await db.delete(schema.users).where(eq(schema.users.id, CURRENT_USER));
  });

  it("puts the week's real dates in the header beside its number", async () => {
    const html = await renderTrainAs(CURRENT_USER);
    // "week 1 of 12" says a position in a skeleton. This says which days.
    expect(html).toContain(
      formatDayRange(THIS_MONDAY, addDaysYmd(THIS_MONDAY, 6))
    );
  });
});
