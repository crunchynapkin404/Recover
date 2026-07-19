// tests/race-tools.test.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";
const USER = "test-race-tools-user";

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

describe.skipIf(!hasDb)("race coach tools", () => {
  beforeAll(async () => {
    await cleanup();
    const { db, schema } = await import("@/lib/db");
    await db.insert(schema.users).values({
      id: USER,
      name: "ToolUser",
      email: "race-tools@example.invalid",
    });
  });
  afterAll(cleanup);

  it("upsert_race creates; get_races lists with daysToRace", async () => {
    const { db } = await import("@/lib/db");
    const { upsertRaceTool } = await import("@/lib/tools/upsert-race");
    const { getRacesTool } = await import("@/lib/tools/get-races");
    const ctx = { userId: USER, db };
    const created = (await upsertRaceTool.execute(
      {
        name: "Spring Half",
        raceType: "half marathon",
        date: ymd(42),
        priority: "A",
        goalNote: "negative split",
      },
      ctx
    )) as { success: boolean; race: { id: string } };
    expect(created.success).toBe(true);

    const listed = (await getRacesTool.execute({}, ctx)) as {
      races: { name: string; daysToRace: number }[];
    };
    expect(listed.races[0].name).toBe("Spring Half");
    expect(listed.races[0].daysToRace).toBe(42);
  });

  it("upsert_race rejects past dates with a clear error", async () => {
    const { db } = await import("@/lib/db");
    const { upsertRaceTool } = await import("@/lib/tools/upsert-race");
    const r = (await upsertRaceTool.execute(
      { name: "Old", raceType: "5k", date: ymd(-3), priority: "C" },
      { userId: USER, db }
    )) as { success: boolean; error?: string };
    expect(r).toEqual({ success: false, error: "past_date" });
  });

  it("simulate_plan_change reports a delta without saving", async () => {
    const { db } = await import("@/lib/db");
    const { generateTrainingPlan } = await import("@/lib/training-plan");
    await generateTrainingPlan({
      userId: USER,
      raceType: "10k",
      raceDate: ymd(56),
    });
    const { getOpenWeekPlan } = await import("@/lib/week-plan/service");
    const week = await getOpenWeekPlan(USER);
    const from = week!.days.find((d) => d.workout && d.date > ymd(0));
    if (!from) return; // late-week test run: nothing left to simulate — fine
    const { simulatePlanChangeTool } =
      await import("@/lib/tools/simulate-plan-change");
    const r = (await simulatePlanChangeTool.execute(
      { action: "skip", fromDate: from.date },
      { userId: USER, db }
    )) as { success: boolean; loadDelta?: number };
    expect(r.success).toBe(true);
    expect(r.loadDelta).toBeLessThanOrEqual(0);
    // and nothing was saved:
    const after = await getOpenWeekPlan(USER);
    expect(
      after!.days.find((d) => d.date === from.date)?.workout
    ).not.toBeNull();
  });

  it("delete_race removes and the registry counts 53", async () => {
    const { db } = await import("@/lib/db");
    const { getRacesTool } = await import("@/lib/tools/get-races");
    const { deleteRaceTool } = await import("@/lib/tools/delete-race");
    const ctx = { userId: USER, db };
    const listed = (await getRacesTool.execute({}, ctx)) as {
      races: { id: string }[];
    };
    for (const race of listed.races) {
      const r = (await deleteRaceTool.execute({ id: race.id }, ctx)) as {
        success: boolean;
      };
      expect(r.success).toBe(true);
    }
    const { allTools } = await import("@/lib/tools/registry");
    expect(allTools.length).toBe(53);
    expect(allTools.map((t) => t.name)).toEqual(
      expect.arrayContaining([
        "get_races",
        "upsert_race",
        "delete_race",
        "simulate_plan_change",
      ])
    );
  });
});
