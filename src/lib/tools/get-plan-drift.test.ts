import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getPlanDriftTool } from "./get-plan-drift";

// requires Postgres; skips without DATABASE_URL.
const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

const USER = "test-get-plan-drift-user";

describe.skipIf(!hasDb)("get_plan_drift openWeek target", () => {
  let planId: string;

  beforeAll(async () => {
    await db
      .insert(schema.users)
      .values({
        id: USER,
        name: "Get Plan Drift Test",
        email: `${USER}@example.test`,
      })
      .onConflictDoNothing();

    const [plan] = await db
      .insert(schema.trainingPlans)
      .values({
        userId: USER,
        title: "Get Plan Drift Test Plan",
        raceType: "marathon",
        raceDate: "2027-01-01",
        startDate: "2026-01-01",
        weeksTotal: 16,
        currentWeek: 3,
        status: "active",
        constraints: {
          planStyle: "block_lite",
          seasonMode: "normal",
          reentryStage: "week_1",
          daysPerWeek: 4,
          hoursPerWeek: 9,
          sports: ["Run"],
        },
      })
      .returning();
    planId = plan.id;

    // Skeleton value deliberately different from the materialized week's
    // effective target below — proves the open week reports the latter,
    // not the un-tapered skeleton figure.
    await db.insert(schema.trainingBlocks).values({
      planId,
      weekNumber: 3,
      phase: "build",
      targetLoadTotal: 500,
      targetSessions: 5,
      workouts: [],
    });

    await db.insert(schema.weekPlans).values({
      userId: USER,
      planId,
      weekStart: "2026-01-15",
      skeletonWeek: 3,
      days: [],
      status: "open",
      effectiveTarget: 320,
    });
  });

  afterAll(async () => {
    await db
      .delete(schema.weekPlans)
      .where(eq(schema.weekPlans.planId, planId));
    await db
      .delete(schema.trainingBlocks)
      .where(eq(schema.trainingBlocks.planId, planId));
    await db
      .delete(schema.trainingPlans)
      .where(eq(schema.trainingPlans.userId, USER));
    await db.delete(schema.users).where(eq(schema.users.id, USER));
  });

  it("reports the materialized week's effective target, not the skeleton value", async () => {
    const result = (await getPlanDriftTool.execute(
      {},
      { userId: USER, db }
    )) as {
      available: boolean;
      openWeek: {
        skeletonWeek: number;
        effectiveTarget: number | null;
      } | null;
    };

    expect(result.available).toBe(true);
    expect(result.openWeek).not.toBeNull();
    expect(result.openWeek?.skeletonWeek).toBe(3);
    // 320 (effectiveTarget), not 500 (the block's skeleton targetLoadTotal).
    expect(result.openWeek?.effectiveTarget).toBe(320);
  });

  it("falls back to the block's skeleton target when the week hasn't materialized", async () => {
    await db
      .update(schema.weekPlans)
      .set({ effectiveTarget: null })
      .where(eq(schema.weekPlans.planId, planId));

    const result = (await getPlanDriftTool.execute(
      {},
      { userId: USER, db }
    )) as {
      openWeek: { effectiveTarget: number | null } | null;
    };

    expect(result.openWeek?.effectiveTarget).toBe(500);

    // Restore for any subsequent test in this file.
    await db
      .update(schema.weekPlans)
      .set({ effectiveTarget: 320 })
      .where(eq(schema.weekPlans.planId, planId));
  });
});
