import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

/**
 * v0.14 Task 15 — /plan race actions. previewPlanChange must be read-only
 * (it powers the DayActions preview step; nothing may persist until
 * applyPlanChange is called), and addRace must reject past dates the same
 * way createRace does.
 *
 * These actions are "use server" + requireUser, so @/lib/session is
 * mocked the same way tests/plan-start-week.test.ts and
 * tests/body-prefs.test.ts do (framework plumbing, not the logic under
 * test). next/cache's revalidatePath throws ("Invariant: static
 * generation store missing") outside a real request context — also
 * stubbed here per the same house pattern, even though the two paths
 * exercised below don't reach it (previewPlanChange never calls it;
 * addRace's past-date rejection returns before it would).
 */

const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";
const USER = "test-plan-actions-race-user";

vi.mock("@/lib/session", () => ({
  requireUser: async () => ({ id: USER, name: "ActionUser" }),
}));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

function ymd(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function cleanup() {
  const { db, schema } = await import("@/lib/db");
  await db.delete(schema.weekPlans).where(eq(schema.weekPlans.userId, USER));
  await db
    .delete(schema.trainingPlans)
    .where(eq(schema.trainingPlans.userId, USER));
  await db.delete(schema.races).where(eq(schema.races.userId, USER));
  await db.delete(schema.users).where(eq(schema.users.id, USER));
}

describe.skipIf(!hasDb)("plan race actions", () => {
  beforeAll(async () => {
    await cleanup();
    const { db, schema } = await import("@/lib/db");
    await db.insert(schema.users).values({
      id: USER,
      name: "ActionUser",
      email: "plan-actions-race@example.invalid",
      role: "member",
    });
    const { generateTrainingPlan } = await import("@/lib/training-plan");
    await generateTrainingPlan({
      userId: USER,
      raceType: "10k",
      raceDate: ymd(56),
    });
  });
  afterAll(cleanup);

  it("previewPlanChange returns a delta and saves nothing", async () => {
    const { getOpenWeekPlan } = await import("@/lib/week-plan/service");
    const { previewPlanChange } = await import("@/app/plan/actions");
    const week = await getOpenWeekPlan(USER);
    const from = week!.days.find((d) => d.workout && d.date > ymd(0));
    if (!from) return; // nothing future to preview this late in the week
    const r = await previewPlanChange({ action: "skip", fromDate: from.date });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.loadDelta).toBeLessThanOrEqual(0);
    const after = await getOpenWeekPlan(USER);
    expect(
      after!.days.find((d) => d.date === from.date)?.workout
    ).not.toBeNull();
  });

  it("addRace validates past dates", async () => {
    const { addRace } = await import("@/app/plan/actions");
    const r = await addRace({
      name: "Old race",
      raceType: "5k",
      date: ymd(-2),
      priority: "C",
    });
    expect(r).toEqual({ ok: false, error: "past_date" });
  });
});
