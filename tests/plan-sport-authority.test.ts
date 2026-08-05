import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";
const USER = "test-plan-sport-user";

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

describe.skipIf(!hasDb)("the race decides the plan's sport", () => {
  beforeAll(async () => {
    await cleanup();
    const { db, schema } = await import("@/lib/db");
    await db.insert(schema.users).values({
      id: USER,
      name: "SportUser",
      email: "plan-sport@example.invalid",
    });
  });
  afterAll(cleanup);

  it("generates cycling for a gran fondo — the case that failed live", async () => {
    const { db, schema } = await import("@/lib/db");
    const { generateTrainingPlan } = await import("@/lib/training-plan");

    const [race] = await db
      .insert(schema.races)
      .values({
        userId: USER,
        name: "Dolomites",
        raceType: "gran_fondo",
        sport: "Bike",
        date: ymd(70),
        priority: "A",
        eventDays: 6,
      })
      .returning();

    const result = await generateTrainingPlan({
      userId: USER,
      raceType: "gran_fondo",
      raceDate: ymd(70),
      raceId: race.id,
    });

    const blocks = await db.query.trainingBlocks.findMany({
      where: eq(schema.trainingBlocks.planId, result.planId),
    });
    expect(blocks.length).toBeGreaterThan(0);
    for (const b of blocks) {
      const workouts = b.workouts as { sport: string }[];
      expect(workouts.length).toBeGreaterThan(0);
      // The live defect: every one of these was "Run".
      expect(workouts.every((w) => w.sport === "Bike")).toBe(true);
    }

    const plan = await db.query.trainingPlans.findFirst({
      where: eq(schema.trainingPlans.id, result.planId),
    });
    const constraints = plan!.constraints as { sports: string[] };
    expect(constraints.sports).toEqual(["Bike"]);
  });

  it("creates its own race carrying the inferred sport", async () => {
    const { db, schema } = await import("@/lib/db");
    const { generateTrainingPlan } = await import("@/lib/training-plan");
    const result = await generateTrainingPlan({
      userId: USER,
      raceType: "marathon",
      raceDate: ymd(80),
    });
    const plan = await db.query.trainingPlans.findFirst({
      where: eq(schema.trainingPlans.id, result.planId),
    });
    const race = await db.query.races.findFirst({
      where: eq(schema.races.id, plan!.raceId!),
    });
    expect(race!.sport).toBe("Run");
  });

  it("refuses a race type that names no sport", async () => {
    const { generateTrainingPlan } = await import("@/lib/training-plan");
    await expect(
      generateTrainingPlan({
        userId: USER,
        raceType: "general_fitness",
        raceDate: ymd(90),
      })
    ).rejects.toThrow(/unsupported plan sport/);
  });
});
