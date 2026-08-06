import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

const USER = "test-training-plan-user";

function futureDate(weeksAhead: number): string {
  const d = new Date();
  d.setDate(d.getDate() + weeksAhead * 7);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function localYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function cleanup() {
  const { db, schema } = await import("@/lib/db");
  // Delete blocks via cascade through plans
  const plans = await db.query.trainingPlans.findMany({
    where: eq(schema.trainingPlans.userId, USER),
  });
  for (const plan of plans) {
    await db
      .delete(schema.trainingBlocks)
      .where(eq(schema.trainingBlocks.planId, plan.id));
  }
  await db
    .delete(schema.trainingPlans)
    .where(eq(schema.trainingPlans.userId, USER));
  await db
    .delete(schema.wellnessDaily)
    .where(eq(schema.wellnessDaily.userId, USER));
  await db.delete(schema.users).where(eq(schema.users.id, USER));
}

describe.skipIf(!hasDb)("training plan generation", () => {
  beforeAll(async () => {
    await cleanup();
    const { db, schema } = await import("@/lib/db");
    await db
      .insert(schema.users)
      .values({
        id: USER,
        name: "PlanTest",
        email: "plan-test@example.invalid",
        role: "member",
      })
      .onConflictDoNothing();

    // Seed wellness with CTL data
    await db.insert(schema.wellnessDaily).values({
      userId: USER,
      date: localYmd(new Date()),
      ctl: 55,
      atl: 65,
      source: "intervals_icu",
    });
  });

  afterAll(async () => {
    await cleanup();
  });

  it("generates a periodized plan with correct phase distribution", async () => {
    const { generateTrainingPlan } = await import("@/lib/training-plan");
    const result = await generateTrainingPlan({
      userId: USER,
      raceType: "Marathon",
      raceDate: futureDate(12),
    });

    expect(result.planId).toBeTruthy();
    expect(result.summary).toContain("12-week");
    expect(result.summary).toContain("Marathon");

    const { db, schema } = await import("@/lib/db");
    const blocks = await db.query.trainingBlocks.findMany({
      where: eq(schema.trainingBlocks.planId, result.planId),
    });

    expect(blocks).toHaveLength(12);

    // Check phase distribution: base ~5w, build ~4w, peak ~1-2w, taper ~2w
    const phases = blocks.map((b) => b.phase);
    const baseCt = phases.filter((p) => p === "base").length;
    const buildCt = phases.filter((p) => p === "build").length;
    const peakCt = phases.filter((p) => p === "peak").length;
    const taperCt = phases.filter((p) => p === "taper").length;
    const recoveryCt = phases.filter((p) => p === "recovery").length;

    // Base should be ~40% = ~5 weeks (minus recovery)
    expect(baseCt + recoveryCt).toBeGreaterThanOrEqual(3);
    // Build should be present
    expect(buildCt).toBeGreaterThanOrEqual(1);
    // Taper should be at least 2 weeks
    expect(taperCt).toBeGreaterThanOrEqual(2);
    // Peak should be at least 1
    expect(peakCt).toBeGreaterThanOrEqual(1);
    // Recovery weeks should exist
    expect(recoveryCt).toBeGreaterThanOrEqual(1);
  });

  it("rejects race dates less than 4 weeks away", async () => {
    const { generateTrainingPlan } = await import("@/lib/training-plan");
    await expect(
      generateTrainingPlan({
        userId: USER,
        raceType: "Marathon",
        raceDate: futureDate(2),
      })
    ).rejects.toThrow("Race too soon for a plan");
  });

  it("rejects race dates more than 52 weeks away", async () => {
    const { generateTrainingPlan } = await import("@/lib/training-plan");
    await expect(
      generateTrainingPlan({
        userId: USER,
        raceType: "Marathon",
        raceDate: futureDate(60),
      })
    ).rejects.toThrow("Race date too far out");
  });

  it("stores plan and blocks in database", async () => {
    const { generateTrainingPlan } = await import("@/lib/training-plan");
    const result = await generateTrainingPlan({
      userId: USER,
      raceType: "Half Marathon",
      raceDate: futureDate(10),
      title: "Fall Half",
    });

    const { db, schema } = await import("@/lib/db");

    // Verify plan row
    const plan = await db.query.trainingPlans.findFirst({
      where: eq(schema.trainingPlans.id, result.planId),
    });
    expect(plan).toBeTruthy();
    expect(plan!.title).toBe("Fall Half");
    expect(plan!.raceType).toBe("Half Marathon");
    expect(plan!.userId).toBe(USER);
    expect(plan!.weeksTotal).toBe(10);
    expect(plan!.startingCtl).toBe(55);
    expect(plan!.status).toBe("active");

    // Verify blocks
    const blocks = await db.query.trainingBlocks.findMany({
      where: eq(schema.trainingBlocks.planId, result.planId),
    });
    expect(blocks).toHaveLength(10);

    // Each block has workouts array
    for (const block of blocks) {
      const workouts = block.workouts as unknown[];
      expect(Array.isArray(workouts)).toBe(true);
      expect(workouts.length).toBeGreaterThan(0);
      expect(block.targetLoadTotal).toBeGreaterThan(0);
      expect(block.targetSessions).toBeGreaterThan(0);
    }
  });

  it("includes sport-appropriate workout types for marathon", async () => {
    const { generateTrainingPlan } = await import("@/lib/training-plan");
    const result = await generateTrainingPlan({
      userId: USER,
      raceType: "Marathon",
      raceDate: futureDate(16),
    });

    const { db, schema } = await import("@/lib/db");
    const blocks = await db.query.trainingBlocks.findMany({
      where: eq(schema.trainingBlocks.planId, result.planId),
    });

    const allWorkouts = blocks.flatMap(
      (b) => b.workouts as { sport: string; type: string }[]
    );

    // Marathon should have running workouts
    expect(allWorkouts.every((w) => w.sport === "Run")).toBe(true);

    // Should contain long runs, tempo, and intervals
    const types = new Set(allWorkouts.map((w) => w.type));
    expect(types.has("Long")).toBe(true);
    expect(types.has("Tempo")).toBe(true);
    expect(types.has("Intervals")).toBe(true);
  });

  it("includes multi-sport workouts for triathlon", async () => {
    const { generateTrainingPlan } = await import("@/lib/training-plan");
    const result = await generateTrainingPlan({
      userId: USER,
      raceType: "Olympic Triathlon",
      raceDate: futureDate(14),
    });

    const { db, schema } = await import("@/lib/db");
    const blocks = await db.query.trainingBlocks.findMany({
      where: eq(schema.trainingBlocks.planId, result.planId),
    });

    const allWorkouts = blocks.flatMap(
      (b) => b.workouts as { sport: string; type: string }[]
    );
    const sports = new Set(allWorkouts.map((w) => w.sport));

    expect(sports.has("Swim")).toBe(true);
    expect(sports.has("Bike")).toBe(true);
    expect(sports.has("Run")).toBe(true);

    // Build/peak blocks should include brick sessions
    const brickWorkouts = allWorkouts.filter((w) => w.type === "Brick");
    expect(brickWorkouts.length).toBeGreaterThan(0);
  });

  it("defaults CTL to 30 when no wellness data exists", async () => {
    const NO_WELLNESS_USER = "test-plan-no-wellness";
    const { db, schema } = await import("@/lib/db");

    // Create user without wellness data
    await db
      .insert(schema.users)
      .values({
        id: NO_WELLNESS_USER,
        name: "NoWellness",
        email: "no-wellness@example.invalid",
        role: "member",
      })
      .onConflictDoNothing();

    try {
      const { generateTrainingPlan } = await import("@/lib/training-plan");
      const result = await generateTrainingPlan({
        userId: NO_WELLNESS_USER,
        raceType: "10k",
        raceDate: futureDate(8),
      });

      const plan = await db.query.trainingPlans.findFirst({
        where: eq(schema.trainingPlans.id, result.planId),
      });
      expect(plan!.startingCtl).toBe(30);
    } finally {
      // Cleanup
      const plans = await db.query.trainingPlans.findMany({
        where: eq(schema.trainingPlans.userId, NO_WELLNESS_USER),
      });
      for (const p of plans) {
        await db
          .delete(schema.trainingBlocks)
          .where(eq(schema.trainingBlocks.planId, p.id));
      }
      await db
        .delete(schema.trainingPlans)
        .where(eq(schema.trainingPlans.userId, NO_WELLNESS_USER));
      await db
        .delete(schema.users)
        .where(eq(schema.users.id, NO_WELLNESS_USER));
    }
  });

  it("respects max 10% load increase per week", async () => {
    const { generateTrainingPlan } = await import("@/lib/training-plan");
    const result = await generateTrainingPlan({
      userId: USER,
      raceType: "Marathon",
      raceDate: futureDate(12),
    });

    const { db, schema } = await import("@/lib/db");
    const blocks = await db.query.trainingBlocks.findMany({
      where: eq(schema.trainingBlocks.planId, result.planId),
    });
    blocks.sort((a, b) => a.weekNumber - b.weekNumber);

    // Check non-recovery, non-taper consecutive weeks
    for (let i = 1; i < blocks.length; i++) {
      const prev = blocks[i - 1];
      const curr = blocks[i];
      if (
        curr.phase !== "recovery" &&
        curr.phase !== "taper" &&
        prev.phase !== "recovery"
      ) {
        const increase =
          (curr.targetLoadTotal! - prev.targetLoadTotal!) /
          prev.targetLoadTotal!;
        expect(increase).toBeLessThanOrEqual(0.11); // 10% + rounding tolerance
      }
    }
  });
});
