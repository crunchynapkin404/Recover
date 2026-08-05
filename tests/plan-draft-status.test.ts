import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";

const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

describe.skipIf(!hasDb)("draft training plans are invisible (v0.43)", () => {
  let db: typeof import("@/lib/db").db;
  let schema: typeof import("@/lib/db").schema;
  let getActivePlan: typeof import("@/lib/active-plan").getActivePlan;
  const userId = `draft-status-${Date.now()}`;

  beforeAll(async () => {
    ({ db, schema } = await import("@/lib/db"));
    ({ getActivePlan } = await import("@/lib/active-plan"));
    await db.insert(schema.users).values({
      id: userId,
      name: "Draft Test",
      email: `${userId}@example.invalid`,
    });
  });

  afterAll(async () => {
    await db.delete(schema.users).where(eq(schema.users.id, userId));
  });

  it("a draft plan is not the active plan", async () => {
    await db.insert(schema.trainingPlans).values({
      userId,
      title: "draft plan",
      raceType: "gran_fondo",
      raceDate: "2026-12-01",
      startDate: "2026-08-05",
      weeksTotal: 12,
      status: "draft",
    });

    expect(await getActivePlan(userId)).toBeNull();
  });

  it("a draft alongside an active plan does not win", async () => {
    const [active] = await db
      .insert(schema.trainingPlans)
      .values({
        userId,
        title: "active plan",
        raceType: "gran_fondo",
        raceDate: "2026-12-01",
        startDate: "2026-08-05",
        weeksTotal: 12,
        status: "active",
      })
      .returning();

    const found = await getActivePlan(userId);
    expect(found?.id).toBe(active.id);
  });
});

// ── Task 2: readers of `trainingPlans` beyond active-plan.ts ───────────────
// Each block below seeds a draft directly (bypassing whatever future
// previewTrainingPlan flow creates one) so the site's own query is what's
// under test, not the write path that got it there.

describe.skipIf(!hasDb)("planIdForRace ignores draft plans (v0.43)", () => {
  let db: typeof import("@/lib/db").db;
  let schema: typeof import("@/lib/db").schema;
  const userId = `draft-debrief-${Date.now()}`;

  beforeAll(async () => {
    ({ db, schema } = await import("@/lib/db"));
    await db.insert(schema.users).values({
      id: userId,
      name: "Draft Debrief Test",
      email: `${userId}@example.invalid`,
    });
  });

  afterAll(async () => {
    await db.delete(schema.users).where(eq(schema.users.id, userId));
  });

  it("a draft plan linked to a race is never returned as the race's plan", async () => {
    const [race] = await db
      .insert(schema.races)
      .values({
        userId,
        name: "Draft-linked race",
        raceType: "gran_fondo",
        sport: "Bike",
        date: "2026-12-01",
        priority: "A",
      })
      .returning();

    const [draft] = await db
      .insert(schema.trainingPlans)
      .values({
        userId,
        title: "draft plan",
        raceType: "gran_fondo",
        raceDate: "2026-12-01",
        startDate: "2026-08-05",
        weeksTotal: 12,
        status: "draft",
        raceId: race.id,
      })
      .returning();

    const { planIdForRace } = await import("@/lib/race/debrief");
    expect(await planIdForRace(userId, race.id)).toBeNull();

    // The draft must lose even when a real plan for the same race exists.
    const [active] = await db
      .insert(schema.trainingPlans)
      .values({
        userId,
        title: "active plan",
        raceType: "gran_fondo",
        raceDate: "2026-12-01",
        startDate: "2026-08-05",
        weeksTotal: 12,
        status: "active",
        raceId: race.id,
      })
      .returning();

    const found = await planIdForRace(userId, race.id);
    expect(found).toBe(active.id);
    expect(found).not.toBe(draft.id);
  });
});

describe.skipIf(!hasDb)("projectWeek refuses a draft-backed week (v0.43)", () => {
  let db: typeof import("@/lib/db").db;
  let schema: typeof import("@/lib/db").schema;
  const userId = `draft-project-${Date.now()}`;

  afterAll(async () => {
    await db.delete(schema.users).where(eq(schema.users.id, userId));
  });

  it("throws rather than project a week onto a draft plan", async () => {
    ({ db, schema } = await import("@/lib/db"));
    await db.insert(schema.users).values({
      id: userId,
      name: "Draft Project Test",
      email: `${userId}@example.invalid`,
    });

    const [draft] = await db
      .insert(schema.trainingPlans)
      .values({
        userId,
        title: "draft plan",
        raceType: "gran_fondo",
        raceDate: "2026-12-01",
        startDate: "2026-08-05",
        weeksTotal: 12,
        status: "draft",
      })
      .returning();

    // A stored week_plans row pointing at the draft — the shape a future
    // consumer could produce, independent of how rolloverWeekPlan behaves
    // today.
    await db.insert(schema.weekPlans).values({
      userId,
      planId: draft.id,
      weekStart: "2026-08-03",
      skeletonWeek: 1,
      days: [],
      status: "open",
    });

    const { projectWeek } = await import("@/lib/week-plan/project");
    await expect(
      projectWeek(userId, "2026-08-03", new Date("2026-08-04T12:00:00Z"))
    ).rejects.toThrow(/no longer exists/);
  });
});

describe.skipIf(!hasDb)(
  "assembleForecastInputs refuses a draft-backed week (v0.43)",
  () => {
    let db: typeof import("@/lib/db").db;
    let schema: typeof import("@/lib/db").schema;
    const userId = `draft-forecast-${Date.now()}`;

    afterAll(async () => {
      await db.delete(schema.users).where(eq(schema.users.id, userId));
    });

    it("returns null when the open week points at a draft plan", async () => {
      ({ db, schema } = await import("@/lib/db"));
      await db.insert(schema.users).values({
        id: userId,
        name: "Draft Forecast Test",
        email: `${userId}@example.invalid`,
      });

      const [draft] = await db
        .insert(schema.trainingPlans)
        .values({
          userId,
          title: "draft plan",
          raceType: "gran_fondo",
          raceDate: "2026-12-01",
          startDate: "2026-08-05",
          weeksTotal: 12,
          status: "draft",
        })
        .returning();

      await db.insert(schema.weekPlans).values({
        userId,
        planId: draft.id,
        weekStart: "2026-08-03",
        skeletonWeek: 1,
        days: [],
        status: "open",
      });

      const { assembleForecastInputs } = await import("@/lib/race/service");
      expect(
        await assembleForecastInputs(userId, null, new Date("2026-08-04"))
      ).toBeNull();
    });
  }
);

describe.skipIf(!hasDb)(
  "getMilestones does not credit a draft plan's blocks (v0.43)",
  () => {
    let db: typeof import("@/lib/db").db;
    let schema: typeof import("@/lib/db").schema;
    const userId = `draft-milestones-${Date.now()}`;

    afterAll(async () => {
      await db.delete(schema.users).where(eq(schema.users.id, userId));
    });

    it("a draft plan's high-adherence block does not count as a completed week", async () => {
      ({ db, schema } = await import("@/lib/db"));
      await db.insert(schema.users).values({
        id: userId,
        name: "Draft Milestones Test",
        email: `${userId}@example.invalid`,
      });

      const [draft] = await db
        .insert(schema.trainingPlans)
        .values({
          userId,
          title: "draft plan",
          raceType: "gran_fondo",
          raceDate: "2026-12-01",
          startDate: "2026-08-05",
          weeksTotal: 12,
          status: "draft",
        })
        .returning();

      // A block that, by adherence alone, would read as a completed week —
      // proves the join is excluding by plan status, not just by there
      // being no real data yet.
      await db.insert(schema.trainingBlocks).values({
        planId: draft.id,
        weekNumber: 1,
        phase: "base",
        workouts: [],
        adherencePct: 90,
      });

      const { getMilestones } = await import("@/lib/insights/milestones");
      const milestones = await getMilestones(userId);
      expect(milestones.planWeeksCompleted).toBe(0);
    });
  }
);
