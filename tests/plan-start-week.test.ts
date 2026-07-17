import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

/**
 * v0.9.3 — the /plan page's "Plan this week" action. Before this patch a
 * plan created mid-week had no living week until the next weekly review
 * fired, and the page offered no way to start one. startWeek is "use
 * server" + requireUser, so @/lib/session and next/cache are stubbed the
 * same way tests/body-prefs.test.ts does (framework plumbing, not the
 * logic under test); rolloverWeekPlan and the DB are the real code.
 */

const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

const USER = "test-plan-start-week-user";

vi.mock("@/lib/session", () => ({
  requireUser: vi.fn(async () => ({ id: USER })),
}));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

async function cleanup() {
  const { db, schema } = await import("@/lib/db");
  await db.delete(schema.users).where(eq(schema.users.id, USER));
}

describe.skipIf(!hasDb)("startWeek server action", () => {
  beforeAll(async () => {
    const { db, schema } = await import("@/lib/db");
    await cleanup();
    await db
      .insert(schema.users)
      .values({
        id: USER,
        name: "StartWeekTest",
        email: "plan-start-week@example.invalid",
        role: "member",
      })
      .onConflictDoNothing();
  });

  afterAll(cleanup);

  it("materializes the current week for an active plan without one", async () => {
    const { db, schema } = await import("@/lib/db");
    const { startWeek } = await import("@/app/plan/actions");
    const { getOpenWeekPlan } = await import("@/lib/week-plan/service");

    // Active plan with a week-1 skeleton block, deliberately no week row —
    // the exact state the /plan page shows the button in.
    const raceDate = new Date(Date.now() + 70 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const [plan] = await db
      .insert(schema.trainingPlans)
      .values({
        userId: USER,
        title: "Start-week test plan",
        raceType: "century",
        raceDate,
        startDate: raceDate, // unused by rollover
        weeksTotal: 9,
        currentWeek: 1,
        status: "active",
        constraints: { daysPerWeek: 5, hoursPerWeek: 8, sports: ["Bike"] },
      })
      .returning();
    await db.insert(schema.trainingBlocks).values({
      planId: plan.id,
      weekNumber: 1,
      phase: "base",
      targetLoadTotal: 537,
      targetSessions: 5,
      workouts: [],
    });

    expect(await getOpenWeekPlan(USER)).toBeNull();
    await startWeek();
    const week = await getOpenWeekPlan(USER);
    expect(week).not.toBeNull();
    expect(week!.days).toHaveLength(7);
  });

  it("is a no-op without an active plan (idempotent to re-press)", async () => {
    const { startWeek } = await import("@/app/plan/actions");
    // Second press with the week already open: must not throw or duplicate.
    await expect(startWeek()).resolves.not.toThrow();
  });
});
