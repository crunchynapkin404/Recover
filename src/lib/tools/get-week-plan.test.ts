import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getWeekPlanTool } from "./get-week-plan";
import type { AvailabilityBlock } from "@/lib/availability/types";

// requires Postgres; skips without DATABASE_URL.
const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

const USER = "test-get-week-plan-user";

/**
 * Triage 5 — this release changes get_week_plan's OUTPUT shape: each day now
 * carries `availableBlocks` and a `workouts` LIST, replacing `availableMins`
 * and a single `workout`. docs/API-STABILITY.md's freeze covers tool inputs,
 * not output content, so this is compliant — but it is a real break for any
 * MCP client reading the old fields, and nothing pinned the new shape.
 *
 * This asserts the contract directly so a later refactor cannot quietly
 * revert or rename it.
 */
describe.skipIf(!hasDb)("get_week_plan day shape", () => {
  const WEEK_START = "2026-09-14"; // a Monday
  const DATES = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(WEEK_START + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });

  const block: AvailabilityBlock = {
    start: "18:00",
    end: "19:00",
    mins: 60,
    energy: "normal",
    sports: null,
  };

  const session = {
    day: 0,
    sport: "Run",
    type: "Endurance",
    durationMins: 60,
    intensity: "Z1-Z2",
    description: "Steady hour",
    purpose: "aerobic_base" as const,
    minEffectiveMins: 40,
    blockIdx: 0,
  };

  let planId: string;

  beforeAll(async () => {
    const { db, schema } = await import("@/lib/db");
    await db
      .insert(schema.users)
      .values({
        id: USER,
        name: "Get Week Plan Test",
        email: `${USER}@example.test`,
      })
      .onConflictDoNothing();
    const [plan] = await db
      .insert(schema.trainingPlans)
      .values({
        userId: USER,
        title: "Get Week Plan Test Plan",
        raceType: "marathon",
        raceDate: "2027-01-01",
        startDate: "2026-01-01",
        weeksTotal: 16,
        currentWeek: 1,
        status: "active",
      })
      .returning();
    planId = plan.id;
  });

  afterAll(async () => {
    const { db, schema } = await import("@/lib/db");
    await db.delete(schema.weekPlans).where(eq(schema.weekPlans.userId, USER));
    await db
      .delete(schema.trainingPlans)
      .where(eq(schema.trainingPlans.userId, USER));
    await db.delete(schema.users).where(eq(schema.users.id, USER));
  });

  beforeEach(async () => {
    const { db, schema } = await import("@/lib/db");
    await db.delete(schema.weekPlans).where(eq(schema.weekPlans.userId, USER));
    await db.insert(schema.weekPlans).values({
      userId: USER,
      planId,
      weekStart: WEEK_START,
      skeletonWeek: 1,
      days: DATES.map((date, i) => ({
        date,
        availableBlocks: [block],
        availableMins: 60,
        workouts: i === 0 ? [session] : [],
        status: i === 0 ? "planned" : "rest",
      })),
      status: "open",
      effectiveTarget: 300,
    });
  });

  it("reports each day as availableBlocks plus a workouts list", async () => {
    const { db } = await import("@/lib/db");
    const result = (await getWeekPlanTool.execute(
      {},
      { userId: USER, db }
    )) as {
      active: boolean;
      effectiveStyle: string;
      effectiveSeasonMode: string;
      reentryStage: string;
      days: Array<Record<string, unknown>>;
    };

    expect(result.active).toBe(true);
    expect(result.effectiveStyle).toBe("balanced");
    expect(result.effectiveSeasonMode).toBe("normal");
    expect(result.reentryStage).toBe("none");
    expect(result.days).toHaveLength(7);

    const monday = result.days[0];
    expect(Array.isArray(monday.availableBlocks)).toBe(true);
    expect(monday.availableBlocks).toEqual([block]);
    expect(Array.isArray(monday.workouts)).toBe(true);
    expect(monday.workouts).toHaveLength(1);
    const mondayWorkout = (
      monday.workouts as Array<Record<string, unknown>>
    )[0];
    expect(mondayWorkout).toHaveProperty("fuelling");
    expect(mondayWorkout.fuelling).toHaveProperty("before");
    expect(mondayWorkout.fuelling).toHaveProperty("during");
    expect(mondayWorkout.fuelling).toHaveProperty("after");

    // The fields this release removed must be gone, not merely unused —
    // a client reading them should fail loudly rather than see undefined.
    expect(monday).not.toHaveProperty("availableMins");
    expect(monday).not.toHaveProperty("workout");

    // A rest day is an empty list, never null or a missing key.
    expect(result.days[1].workouts).toEqual([]);
  });
});
