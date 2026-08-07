import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getTrainingPlanTool } from "./get-training-plan";

// requires Postgres; skips without DATABASE_URL.
const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

const USER = "test-get-training-plan-user";

describe.skipIf(!hasDb)("get_training_plan effective-state parity", () => {
  let planId: string;

  beforeAll(async () => {
    await db
      .insert(schema.users)
      .values({
        id: USER,
        name: "Get Training Plan Test",
        email: `${USER}@example.test`,
      })
      .onConflictDoNothing();

    const [plan] = await db
      .insert(schema.trainingPlans)
      .values({
        userId: USER,
        title: "Get Training Plan Test Plan",
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

    await db.insert(schema.trainingBlocks).values({
      planId,
      weekNumber: 3,
      phase: "build",
      targetLoadTotal: 360,
      targetSessions: 5,
      workouts: [],
    });
  });

  afterAll(async () => {
    await db
      .delete(schema.trainingBlocks)
      .where(eq(schema.trainingBlocks.planId, planId));
    await db
      .delete(schema.trainingPlans)
      .where(eq(schema.trainingPlans.userId, USER));
    await db.delete(schema.users).where(eq(schema.users.id, USER));
  });

  it("returns normalized effective planning state in overview", async () => {
    const result = (await getTrainingPlanTool.execute(
      {},
      { userId: USER, db }
    )) as {
      available: boolean;
      plan: {
        id: string;
        effectiveStyle: string;
        effectiveSeasonMode: string;
        reentryStage: string;
      };
    };

    expect(result.available).toBe(true);
    expect(result.plan.id).toBe(planId);
    expect(result.plan.effectiveStyle).toBe("block_lite");
    expect(result.plan.effectiveSeasonMode).toBe("normal");
    expect(result.plan.reentryStage).toBe("none");
  });

  it("returns normalized effective planning state in week detail", async () => {
    const result = (await getTrainingPlanTool.execute(
      { weekNumber: 3 },
      { userId: USER, db }
    )) as {
      available: boolean;
      plan: {
        id: string;
        effectiveStyle: string;
        effectiveSeasonMode: string;
        reentryStage: string;
      };
      week: { weekNumber: number };
    };

    expect(result.available).toBe(true);
    expect(result.plan.id).toBe(planId);
    expect(result.plan.effectiveStyle).toBe("block_lite");
    expect(result.plan.effectiveSeasonMode).toBe("normal");
    expect(result.plan.reentryStage).toBe("none");
    expect(result.week.weekNumber).toBe(3);
  });

  it("keeps off-season reentry stage when mode is off_season", async () => {
    await db
      .update(schema.trainingPlans)
      .set({
        constraints: { seasonMode: "off_season", reentryStage: "week_2" },
      })
      .where(
        and(
          eq(schema.trainingPlans.userId, USER),
          eq(schema.trainingPlans.id, planId)
        )
      );

    const result = (await getTrainingPlanTool.execute(
      {},
      { userId: USER, db }
    )) as {
      available: boolean;
      plan: {
        effectiveStyle: string;
        effectiveSeasonMode: string;
        reentryStage: string;
      };
    };

    expect(result.available).toBe(true);
    expect(result.plan.effectiveStyle).toBe("balanced");
    expect(result.plan.effectiveSeasonMode).toBe("off_season");
    expect(result.plan.reentryStage).toBe("week_2");
  });
});
