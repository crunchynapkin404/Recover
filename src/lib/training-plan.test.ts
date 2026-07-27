import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import {
  generateWorkouts,
  withPurpose,
  PURPOSE_BY_TYPE,
  generateTrainingPlan,
} from "./training-plan";

// requires Postgres; skips without DATABASE_URL.
const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

describe("workout purpose", () => {
  it("maps every generated type to a purpose one-to-one", () => {
    expect(PURPOSE_BY_TYPE).toEqual({
      Recovery: "recovery",
      Endurance: "aerobic_base",
      Long: "long",
      Tempo: "threshold",
      Intervals: "vo2max",
      Brick: "brick",
    });
  });

  it("stamps purpose and floor onto a bare workout", () => {
    const w = withPurpose({
      day: 2,
      sport: "Bike",
      type: "Intervals",
      durationMins: 90,
      intensity: "Z4-Z5",
      description: "VO2max intervals",
    });
    expect(w.purpose).toBe("vo2max");
    expect(w.minEffectiveMins).toBe(40);
  });

  it("falls back to aerobic_base for an unknown type", () => {
    const w = withPurpose({
      day: 0,
      sport: "Bike",
      type: "Mystery",
      durationMins: 60,
      intensity: "Z1-Z2",
      description: "?",
    });
    expect(w.purpose).toBe("aerobic_base");
    expect(w.minEffectiveMins).toBe(40);
  });

  it("gives every generated workout a purpose and a floor", () => {
    const ws = generateWorkouts(4, 8, "build", "Gran Fondo", ["Bike"]);
    expect(ws.length).toBeGreaterThan(0);
    for (const w of ws) {
      expect(w.purpose).toBeDefined();
      expect(w.minEffectiveMins).toBeGreaterThan(0);
    }
  });
});

describe.skipIf(!hasDb)("generateTrainingPlan — availability seeding", () => {
  const FRESH_USER = "test-seed-availability-fresh";
  const CONFIGURED_USER = "test-seed-availability-configured";

  async function cleanupUser(userId: string): Promise<void> {
    await db
      .delete(schema.weekPlans)
      .where(eq(schema.weekPlans.userId, userId));
    await db
      .delete(schema.trainingPlans)
      .where(eq(schema.trainingPlans.userId, userId));
    await db.delete(schema.races).where(eq(schema.races.userId, userId));
    await db
      .delete(schema.availabilityDefaults)
      .where(eq(schema.availabilityDefaults.userId, userId));
    await db.delete(schema.users).where(eq(schema.users.id, userId));
  }

  beforeAll(async () => {
    await cleanupUser(FRESH_USER);
    await cleanupUser(CONFIGURED_USER);
    await db.insert(schema.users).values([
      {
        id: FRESH_USER,
        name: "Fresh Seed User",
        email: `${FRESH_USER}@example.invalid`,
      },
      {
        id: CONFIGURED_USER,
        name: "Configured Seed User",
        email: `${CONFIGURED_USER}@example.invalid`,
      },
    ]);
  });

  afterAll(async () => {
    await cleanupUser(FRESH_USER);
    await cleanupUser(CONFIGURED_USER);
  });

  it("seeds a standard week — spread over daysPerWeek days, totalling roughly hoursPerWeek", async () => {
    await generateTrainingPlan({
      userId: FRESH_USER,
      raceType: "marathon",
      raceDate: "2026-12-01",
      daysPerWeek: 4,
      hoursPerWeek: 6,
    });

    const rows = await db.query.availabilityDefaults.findMany({
      where: eq(schema.availabilityDefaults.userId, FRESH_USER),
    });
    expect(rows).toHaveLength(7);

    const daysWithBlocks = rows.filter(
      (r) => (r.blocks as unknown[]).length > 0
    );
    expect(daysWithBlocks).toHaveLength(4);

    const totalMins = rows.reduce(
      (sum, r) =>
        sum + (r.blocks as { mins: number }[]).reduce((s, b) => s + b.mins, 0),
      0
    );
    // hoursPerWeek=6 -> 360 minutes, rounded to the nearest 5min per day.
    expect(totalMins).toBeGreaterThanOrEqual(350);
    expect(totalMins).toBeLessThanOrEqual(370);
  });

  it("leaves a pre-existing standard week untouched when a second plan is created", async () => {
    const customBlock = {
      start: "06:00",
      end: "06:30",
      mins: 30,
      energy: "easy",
      sports: null,
    };
    // Sunday (weekday 6) — a day generateTrainingPlan's seeding would
    // otherwise populate for daysPerWeek=5.
    await db.insert(schema.availabilityDefaults).values({
      userId: CONFIGURED_USER,
      weekday: 6,
      blocks: [customBlock],
    });

    await generateTrainingPlan({
      userId: CONFIGURED_USER,
      raceType: "marathon",
      raceDate: "2026-12-15",
      daysPerWeek: 5,
      hoursPerWeek: 8,
    });

    const row = await db.query.availabilityDefaults.findFirst({
      where: and(
        eq(schema.availabilityDefaults.userId, CONFIGURED_USER),
        eq(schema.availabilityDefaults.weekday, 6)
      ),
    });
    expect(row?.blocks).toEqual([customBlock]);
  });
});
