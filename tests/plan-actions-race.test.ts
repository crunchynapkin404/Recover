import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";

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
    const from = week!.days.find(
      (d) => d.workouts.length > 0 && d.date > ymd(0)
    );
    if (!from) return; // nothing future to preview this late in the week
    const r = await previewPlanChange({ action: "skip", fromDate: from.date });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.loadDelta).toBeLessThanOrEqual(0);
    const after = await getOpenWeekPlan(USER);
    expect(
      after!.days.find((d) => d.date === from.date)?.workouts[0]
    ).not.toBeUndefined();
  });

  it("addRace validates past dates", async () => {
    const { addRace } = await import("@/app/plan/actions");
    const r = await addRace({
      name: "Old race",
      raceType: "5k",
      date: ymd(-2),
      priority: "C",
      eventDays: 1,
      distanceKm: null,
      elevationM: null,
      stages: [],
    });
    expect(r).toEqual({ ok: false, error: "past_date" });
  });

  /**
   * Task 10 review Finding 4: races-section-demand.test.tsx mocks addRace
   * entirely (it only proves the client sends the right shape), and the
   * past-date test above never reads anything back. These read schema.races
   * and schema.raceStages after the call to prove the server write path
   * actually persists the demand fields field-by-field — swapping
   * distanceKm/elevationM in the actions.ts .set({...}) left all of the
   * shape-only tests passing.
   */
  it("persists event demand and per-day stages field by field, rounding fractional elevation", async () => {
    const { addRace } = await import("@/app/plan/actions");
    const { db, schema } = await import("@/lib/db");
    const date = ymd(40);
    const name = "Stage Race Demand";

    const r = await addRace({
      name,
      raceType: "cycling",
      date,
      priority: "A",
      eventDays: 3,
      distanceKm: 300.5,
      elevationM: 4500.6,
      stages: [
        { dayNumber: 1, distanceKm: 100, elevationM: 1500.4 },
        { dayNumber: 2, distanceKm: 100.25, elevationM: 1500 },
        { dayNumber: 3, distanceKm: 100.25, elevationM: 1500 },
      ],
    });
    expect(r).toEqual({ ok: true });

    const race = await db.query.races.findFirst({
      where: and(eq(schema.races.userId, USER), eq(schema.races.name, name)),
    });
    expect(race).toBeDefined();
    expect(race!.eventDays).toBe(3);
    expect(race!.distanceKm).toBeCloseTo(300.5);
    // elevation_m is an integer column: 4500.6 must round, not truncate or throw.
    expect(race!.elevationM).toBe(4501);

    const stages = (
      await db.query.raceStages.findMany({
        where: eq(schema.raceStages.raceId, race!.id),
      })
    ).sort((a, b) => a.dayNumber - b.dayNumber);
    expect(stages).toHaveLength(3);
    expect(stages[0].distanceKm).toBeCloseTo(100);
    expect(stages[0].elevationM).toBe(1500); // 1500.4 rounds down
    expect(stages[1].distanceKm).toBeCloseTo(100.25);
    expect(stages[1].elevationM).toBe(1500);
    expect(stages[2].dayNumber).toBe(3);
  });

  it("re-submitting the same race with fewer days drops the stale stage rows", async () => {
    const { addRace } = await import("@/app/plan/actions");
    const { db, schema } = await import("@/lib/db");
    const date = ymd(41);
    const name = "Shrinking Stage Race";

    const first = await addRace({
      name,
      raceType: "cycling",
      date,
      priority: "B",
      eventDays: 3,
      distanceKm: 300,
      elevationM: 3000,
      stages: [
        { dayNumber: 1, distanceKm: 100, elevationM: 1000 },
        { dayNumber: 2, distanceKm: 100, elevationM: 1000 },
        { dayNumber: 3, distanceKm: 100, elevationM: 1000 },
      ],
    });
    expect(first).toEqual({ ok: true });

    // Same (userId, date, name) — createRace's upsert key — reuses the row.
    const second = await addRace({
      name,
      raceType: "cycling",
      date,
      priority: "B",
      eventDays: 2,
      distanceKm: 200,
      elevationM: 2000,
      stages: [
        { dayNumber: 1, distanceKm: 100, elevationM: 1000 },
        { dayNumber: 2, distanceKm: 100, elevationM: 1000 },
      ],
    });
    expect(second).toEqual({ ok: true });

    const race = await db.query.races.findFirst({
      where: and(eq(schema.races.userId, USER), eq(schema.races.name, name)),
    });
    expect(race).toBeDefined();
    expect(race!.eventDays).toBe(2);

    const stages = await db.query.raceStages.findMany({
      where: eq(schema.raceStages.raceId, race!.id),
    });
    expect(stages).toHaveLength(2);
    expect(stages.some((s) => s.dayNumber === 3)).toBe(false);
  });

  it("rejects invalid demand values without writing anything", async () => {
    const { addRace } = await import("@/app/plan/actions");
    const { db, schema } = await import("@/lib/db");
    const date = ymd(42);

    const cases: {
      name: string;
      eventDays: number;
      distanceKm: number | null;
      elevationM: number | null;
      stages: {
        dayNumber: number;
        distanceKm: number | null;
        elevationM: number | null;
      }[];
    }[] = [
      {
        name: "Bad Distance Race",
        eventDays: 1,
        distanceKm: -5,
        elevationM: null,
        stages: [],
      },
      {
        name: "Bad Elevation Race",
        eventDays: 1,
        distanceKm: null,
        elevationM: NaN,
        stages: [],
      },
      {
        name: "Bad Elevation Infinity Race",
        eventDays: 1,
        distanceKm: null,
        elevationM: Infinity,
        stages: [],
      },
      {
        // race_stages has a unique index on (raceId, dayNumber). The
        // transaction stops this corrupting anything, but the action's
        // contract is to return errors, not throw them — and it is a
        // reachable "use server" endpoint, so a caller other than our own
        // form can send this.
        name: "Duplicate Stage Day Race",
        eventDays: 2,
        distanceKm: 100,
        elevationM: 100,
        stages: [
          { dayNumber: 1, distanceKm: 10, elevationM: 0 },
          { dayNumber: 1, distanceKm: 20, elevationM: 0 },
        ],
      },
      {
        name: "Bad Stage Day Number Race",
        eventDays: 2,
        distanceKm: 100,
        elevationM: 100,
        stages: [
          { dayNumber: 0, distanceKm: 10, elevationM: 0 },
          { dayNumber: 1, distanceKm: 20, elevationM: 0 },
        ],
      },
      {
        name: "Bad Stage Distance Race",
        eventDays: 2,
        distanceKm: 100,
        elevationM: 100,
        stages: [
          { dayNumber: 1, distanceKm: -10, elevationM: 0 },
          { dayNumber: 2, distanceKm: 10, elevationM: 0 },
        ],
      },
      {
        name: "Bad Stage Elevation Race",
        eventDays: 2,
        distanceKm: 100,
        elevationM: 100,
        stages: [
          { dayNumber: 1, distanceKm: 10, elevationM: NaN },
          { dayNumber: 2, distanceKm: 10, elevationM: 0 },
        ],
      },
      {
        name: "Bad Event Days Race",
        eventDays: 0,
        distanceKm: null,
        elevationM: null,
        stages: [],
      },
    ];

    for (const c of cases) {
      const r = await addRace({
        name: c.name,
        raceType: "cycling",
        date,
        priority: "C",
        eventDays: c.eventDays,
        distanceKm: c.distanceKm,
        elevationM: c.elevationM,
        stages: c.stages,
      });
      expect(r.ok, `case ${c.name} should be rejected`).toBe(false);

      const rows = await db.query.races.findMany({
        where: and(
          eq(schema.races.userId, USER),
          eq(schema.races.name, c.name)
        ),
      });
      expect(rows, `case ${c.name} must not write a race row`).toHaveLength(0);
    }
  });
});
