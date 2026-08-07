import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getActivePlan } from "@/lib/active-plan";
import { getTrainingPlanTool } from "@/lib/tools/get-training-plan";
import { getPlanDriftTool } from "@/lib/tools/get-plan-drift";

// requires Postgres; skips without DATABASE_URL.
const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

const USER = "test-plan-identity-user";

/**
 * Three active plans, mirroring the owner's live state on 2026-08-01: one
 * creation retry left three rows minutes apart, the newest holding the week
 * the engine actually runs. Before this release the unordered consumers
 * returned the OLDEST (heap order), so the coach reported week 1 against an
 * engine running week 4.
 */
const PLANS = [
  { currentWeek: 1, hoursPerWeek: 11.5, createdAt: "2026-07-15T12:14:00Z" },
  { currentWeek: 1, hoursPerWeek: 10, createdAt: "2026-07-15T12:17:00Z" },
  { currentWeek: 4, hoursPerWeek: 10, createdAt: "2026-07-15T12:46:00Z" },
];

describe.skipIf(!hasDb)("every consumer resolves the same active plan", () => {
  let newestId: string;

  beforeAll(async () => {
    await db
      .insert(schema.users)
      .values({ id: USER, name: USER, email: `${USER}@example.invalid` })
      .onConflictDoNothing();
    await db
      .delete(schema.trainingPlans)
      .where(eq(schema.trainingPlans.userId, USER));

    for (const p of PLANS) {
      const [row] = await db
        .insert(schema.trainingPlans)
        .values({
          userId: USER,
          title: "century training plan",
          raceType: "century",
          raceDate: "2026-09-13",
          startDate: "2026-07-15",
          weeksTotal: 9,
          currentWeek: p.currentWeek,
          startingCtl: 50,
          status: "active",
          constraints: {
            daysPerWeek: 4,
            hoursPerWeek: p.hoursPerWeek,
            sports: ["Bike"],
            planStyle: "block_lite",
            seasonMode: "normal",
            reentryStage: "week_1",
          },
          createdAt: new Date(p.createdAt),
        })
        .returning();
      newestId = row.id;
    }

    // Blocks exist ONLY on the newest plan. That asymmetry is what makes the
    // assertions below discriminating: a consumer resolving one of the older
    // rows finds no blocks at all and returns a visibly different answer.
    //
    // Week 4 carries actualLoad so get_plan_drift counts it as a completed
    // week. Week 5 is the one update_training_plan mutates, kept separate so
    // the update test cannot perturb the drift test regardless of order.
    await db.insert(schema.trainingBlocks).values([
      {
        planId: newestId,
        weekNumber: 4,
        phase: "build",
        targetLoadTotal: 300,
        targetSessions: 4,
        workouts: [],
        actualLoad: 280,
      },
      {
        planId: newestId,
        weekNumber: 5,
        phase: "build",
        targetLoadTotal: 300,
        targetSessions: 4,
        workouts: [],
      },
    ]);
  });

  afterAll(async () => {
    await db
      .delete(schema.trainingPlans)
      .where(eq(schema.trainingPlans.userId, USER));
  });

  it("seeded three active plans, newest on week 4", async () => {
    const rows = await db.query.trainingPlans.findMany({
      where: eq(schema.trainingPlans.userId, USER),
    });
    expect(rows).toHaveLength(3);
    expect(rows.filter((r) => r.status === "active")).toHaveLength(3);
  });

  it("the resolver picks the newest", async () => {
    const plan = await getActivePlan(USER);
    expect(plan?.id).toBe(newestId);
    expect(plan?.currentWeek).toBe(4);
  });

  it("get_training_plan reports the resolver's plan", async () => {
    const result = (await getTrainingPlanTool.execute(
      {},
      { userId: USER, db }
    )) as {
      available: boolean;
      plan: {
        id: string;
        currentWeek: number;
        effectiveStyle: string;
        effectiveSeasonMode: string;
        reentryStage: string;
      };
    };
    expect(result.available).toBe(true);
    expect(result.plan.id).toBe(newestId);
    expect(result.plan.currentWeek).toBe(4);
    expect(result.plan.effectiveStyle).toBe("block_lite");
    expect(result.plan.effectiveSeasonMode).toBe("normal");
    expect(result.plan.reentryStage).toBe("none");
  });

  it("get_plan_drift reads the resolver's plan blocks", async () => {
    // get_plan_drift returns no plan id — it reports `weeks`, derived from
    // the blocks of whichever plan it resolved. Only the newest plan has
    // blocks, so resolving an older row yields an empty weeks list and the
    // "no completed plan weeks yet" summary. That difference is the assertion.
    const result = (await getPlanDriftTool.execute(
      {},
      { userId: USER, db }
    )) as {
      available: boolean;
      weeks: { week: number; actualLoad: number | null }[];
    };
    expect(result.available).toBe(true);
    expect(result.weeks).toHaveLength(1);
    expect(result.weeks[0].week).toBe(4);
    expect(result.weeks[0].actualLoad).toBe(280);
  });

  it("update_training_plan writes to the plan the resolver reads", async () => {
    const { updateTrainingPlanTool } =
      await import("@/lib/tools/update-training-plan");
    const result = (await updateTrainingPlanTool.execute(
      {
        weekNumber: 5,
        action: "reduce_load",
        reason: "plan identity regression test",
      },
      { userId: USER, db }
    )) as { success: boolean; newTargetLoad?: number };

    // Only the newest plan has a week 5, so resolving an older row returns
    // week_not_found and writes nothing at all.
    expect(result.success).toBe(true);
    expect(result.newTargetLoad).toBe(210); // 300 * 0.7

    const block = await db.query.trainingBlocks.findFirst({
      where: and(
        eq(schema.trainingBlocks.planId, newestId),
        eq(schema.trainingBlocks.weekNumber, 5)
      ),
    });
    expect(block?.targetLoadTotal).toBe(210);
  });

  it("update_training_plan set_style returns full effective-state parity", async () => {
    const { updateTrainingPlanTool } =
      await import("@/lib/tools/update-training-plan");
    const result = (await updateTrainingPlanTool.execute(
      {
        action: "set_style",
        planStyle: "balanced",
        reason: "plan identity style parity",
      },
      { userId: USER, db }
    )) as {
      success: boolean;
      effectiveStyle?: string;
      effectiveSeasonMode?: string;
      reentryStage?: string;
    };

    expect(result.success).toBe(true);
    expect(result.effectiveStyle).toBe("balanced");
    expect(result.effectiveSeasonMode).toBe("normal");
    expect(result.reentryStage).toBe("none");
  });

  it("update_training_plan begin_reentry returns full effective-state parity", async () => {
    const { updateTrainingPlanTool } =
      await import("@/lib/tools/update-training-plan");
    const result = (await updateTrainingPlanTool.execute(
      {
        action: "begin_reentry",
        reason: "plan identity reentry parity",
      },
      { userId: USER, db }
    )) as {
      success: boolean;
      effectiveStyle?: string;
      effectiveSeasonMode?: string;
      reentryStage?: string;
    };

    expect(result.success).toBe(true);
    expect(result.effectiveStyle).toBe("balanced");
    expect(result.effectiveSeasonMode).toBe("off_season");
    expect(result.reentryStage).toBe("week_1");
  });
});
