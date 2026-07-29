import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import {
  generateWorkouts,
  withPurpose,
  PURPOSE_BY_TYPE,
  generateTrainingPlan,
  longRideBoundMins,
  distributeRemainder,
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

describe("longRideBoundMins", () => {
  it("falls back to today's cap when there is no event demand", () => {
    // No race, or no FTP -> eventDemand returns null. Keep today's
    // behaviour rather than inventing a bound on no evidence.
    expect(longRideBoundMins(null)).toBe(240);
  });

  it("uses the event's hardest day", () => {
    // The Ride - Dolomites 2026: queenStageHours 4.897963084361944
    expect(longRideBoundMins(4.897963084361944)).toBe(294);
  });

  it("floors a very short event at a useful endurance stimulus", () => {
    // A criterium's queen stage is under an hour; a 30-minute "long ride"
    // is not an endurance session.
    expect(longRideBoundMins(0.5)).toBe(120);
  });

  it("never exceeds the absolute six-hour bound", () => {
    expect(longRideBoundMins(9)).toBe(360);
  });

  it("treats nonsense demand as no demand", () => {
    expect(longRideBoundMins(0)).toBe(240);
    expect(longRideBoundMins(-1)).toBe(240);
    expect(longRideBoundMins(Number.NaN)).toBe(240);
  });
});

describe("distributeRemainder", () => {
  it("splits the remainder evenly when everyone has headroom", () => {
    // The live case: two 90-minute endurance rides clamped from 197.
    expect(distributeRemainder([90, 90], [294, 294], 214)).toEqual([197, 197]);
  });

  it("spills onto sessions with room when one hits its bound", () => {
    // 0 can take only 20 more; the other 30 must land on 1, not vanish.
    expect(distributeRemainder([100, 50], [120, 300], 100)).toEqual([120, 130]);
  });

  it("stops when nothing has headroom, rather than looping", () => {
    expect(distributeRemainder([100], [100], 50)).toEqual([100]);
  });

  it("is a no-op for a zero or negative remainder", () => {
    expect(distributeRemainder([60, 60], [200, 200], 0)).toEqual([60, 60]);
    expect(distributeRemainder([60, 60], [200, 200], -10)).toEqual([60, 60]);
  });

  it("never exceeds any bound", () => {
    const out = distributeRemainder([10, 10, 10], [20, 20, 20], 1000);
    expect(out).toEqual([20, 20, 20]);
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
