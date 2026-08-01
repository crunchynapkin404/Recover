import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { logger } from "@/lib/logger";
import { getActivePlan } from "./active-plan";

// requires Postgres; skips without DATABASE_URL.
const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

const USER = "test-active-plan-user";
const EMPTY_USER = "test-active-plan-empty-user";

async function insertPlan(currentWeek: number, createdAt: Date) {
  const [row] = await db
    .insert(schema.trainingPlans)
    .values({
      userId: USER,
      title: "Test Century Plan",
      raceType: "century",
      raceDate: "2026-09-13",
      startDate: "2026-07-13",
      weeksTotal: 9,
      currentWeek,
      startingCtl: 50,
      status: "active",
      constraints: { daysPerWeek: 4, hoursPerWeek: 10, sports: ["Bike"] },
      createdAt,
    })
    .returning();
  return row;
}

describe.skipIf(!hasDb)("getActivePlan", () => {
  beforeAll(async () => {
    for (const id of [USER, EMPTY_USER]) {
      await db
        .insert(schema.users)
        .values({ id, name: id, email: `${id}@example.invalid` })
        .onConflictDoNothing();
    }
    await db
      .delete(schema.trainingPlans)
      .where(eq(schema.trainingPlans.userId, USER));
  });

  afterAll(async () => {
    await db
      .delete(schema.trainingPlans)
      .where(eq(schema.trainingPlans.userId, USER));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns null when the athlete has no plan at all", async () => {
    expect(await getActivePlan(EMPTY_USER)).toBeNull();
  });

  it("returns the only active plan", async () => {
    const only = await insertPlan(1, new Date("2026-07-15T12:14:00Z"));
    const found = await getActivePlan(USER);
    expect(found?.id).toBe(only.id);
    // The resolver returns the whole row, not a column projection.
    expect(found?.title).toBe("Test Century Plan");
    expect(found?.raceType).toBe("century");
    expect(found?.constraints).toEqual({
      daysPerWeek: 4,
      hoursPerWeek: 10,
      sports: ["Bike"],
    });
    await db
      .delete(schema.trainingPlans)
      .where(eq(schema.trainingPlans.userId, USER));
  });

  it("picks the newest by createdAt when several are active", async () => {
    // Reproduces the owner's live state: three actives from one creation
    // retry, the newest carrying the week the engine actually runs.
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});

    await insertPlan(1, new Date("2026-07-15T12:14:00Z"));
    await insertPlan(1, new Date("2026-07-15T12:17:00Z"));
    const newest = await insertPlan(4, new Date("2026-07-15T12:46:00Z"));

    const found = await getActivePlan(USER);
    expect(found?.id).toBe(newest.id);
    expect(found?.currentWeek).toBe(4);

    // The ambiguity warning is the primary observable signal this release
    // exists to surface — assert it fires with the right fields.
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      "multiple active training plans",
      expect.objectContaining({
        userId: USER,
        count: 3,
        chosen: newest.id,
      })
    );
  });

  it("ignores archived plans even when they are newer", async () => {
    await db
      .insert(schema.trainingPlans)
      .values({
        userId: USER,
        title: "Archived Later Plan",
        raceType: "century",
        raceDate: "2026-09-13",
        startDate: "2026-07-13",
        weeksTotal: 9,
        currentWeek: 9,
        status: "archived",
        constraints: { daysPerWeek: 4, hoursPerWeek: 10, sports: ["Bike"] },
        createdAt: new Date("2026-08-01T00:00:00Z"),
      })
      .returning();

    const found = await getActivePlan(USER);
    expect(found?.status).toBe("active");
    expect(found?.currentWeek).toBe(4);
  });
});
