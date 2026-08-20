/**
 * Task 9: `generate_training_plan` gains an optional `secondRaceId`.
 *
 * The load-bearing guarantee is that omitting `secondRaceId` is
 * byte-identical to the tool's pre-Task-9 contract — the mapping added here
 * must be a no-op on that path. The tests below prove it by comparing the
 * tool's output, field for field (minus the always-fresh `planId`), against
 * a direct `previewTrainingPlan({ raceId })` call — the exact call shape the
 * tool made before this task existed.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { generateTrainingPlanTool } from "./generate-training-plan";
import { previewTrainingPlan } from "@/lib/training-plan";
import { REFUSAL_TEXT } from "@/lib/plan-preview";
import { addDaysYmd } from "@/lib/week-plan/service";

// requires Postgres; skips without DATABASE_URL.
const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

describe.skipIf(!hasDb)("generate_training_plan — secondRaceId", () => {
  const USER = "test-generate-training-plan-second-race";

  function todayYmd(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  // Far enough out to clear the 52-week horizon refusal with room to spare
  // for a second race further out still.
  const FIRST_DATE = addDaysYmd(todayYmd(), 140);

  async function cleanup(): Promise<void> {
    await db
      .delete(schema.trainingPlans)
      .where(eq(schema.trainingPlans.userId, USER));
    await db.delete(schema.races).where(eq(schema.races.userId, USER));
  }

  beforeAll(async () => {
    await cleanup();
    await db.delete(schema.users).where(eq(schema.users.id, USER));
    await db.insert(schema.users).values({
      id: USER,
      name: "Second Race Tool Test",
      email: `${USER}@example.invalid`,
    });
  });

  afterEach(cleanup);

  afterAll(async () => {
    await cleanup();
    await db.delete(schema.users).where(eq(schema.users.id, USER));
  });

  async function makeRace(opts: {
    name: string;
    raceType: string;
    date: string;
    priority?: "A" | "B" | "C";
    status?: "upcoming" | "completed" | "skipped";
  }): Promise<string> {
    const [row] = await db
      .insert(schema.races)
      .values({
        userId: USER,
        name: opts.name,
        raceType: opts.raceType,
        sport: "Run",
        date: opts.date,
        priority: opts.priority ?? "A",
        status: opts.status ?? "upcoming",
      })
      .returning();
    return row.id;
  }

  it("omitting secondRaceId is byte-identical to a direct raceId-only previewTrainingPlan call", async () => {
    const raceId = await makeRace({
      name: "Solo Marathon",
      raceType: "marathon",
      date: FIRST_DATE,
    });

    const toolResult = (await generateTrainingPlanTool.execute(
      {
        raceType: "marathon",
        raceDate: FIRST_DATE,
        raceId,
        daysPerWeek: 5,
        hoursPerWeek: 8,
      },
      { userId: USER, db }
    )) as { success: boolean; preview: Record<string, unknown> };

    // The reference call is exactly the shape the tool made before this
    // task: `{ userId, ...args }` with `args.raceId` set and no `raceIds`.
    const direct = await previewTrainingPlan({
      userId: USER,
      raceType: "marathon",
      raceDate: FIRST_DATE,
      raceId,
      daysPerWeek: 5,
      hoursPerWeek: 8,
    });
    if (!direct.ok) throw new Error("expected direct call to succeed");

    expect(toolResult.success).toBe(true);
    // planId is fresh on every previewTrainingPlan call (one draft row per
    // athlete, deleted and reinserted) -- everything else must match exactly.
    const { planId: toolPlanId, ...toolRest } = toolResult.preview;
    const { planId: directPlanId, ...directRest } = direct.preview;
    expect(typeof toolPlanId).toBe("string");
    expect(typeof directPlanId).toBe("string");
    expect(toolRest).toEqual(directRest);

    // Pin the exact top-level response shape so a future change that leaks
    // an extra field (e.g. echoing secondRaceId back) goes red here.
    expect(Object.keys(toolResult).sort()).toEqual(["preview", "success"]);
    expect(Object.keys(toolResult.preview).sort()).toEqual(
      [
        "planId",
        "sport",
        "race",
        "startDate",
        "weeksTotal",
        "daysPerWeek",
        "hoursPerWeek",
        "phases",
        "weeks",
        "startingCtl",
        "feasibility",
        "volume",
        "warnings",
      ].sort()
    );
  });

  it("targets both races when secondRaceId is given, the later date as the final target", async () => {
    const laterDate = addDaysYmd(FIRST_DATE, 60);
    const first = await makeRace({
      name: "Spring A-Race",
      raceType: "marathon",
      date: FIRST_DATE,
    });
    const second = await makeRace({
      name: "Fall A-Race",
      raceType: "marathon",
      date: laterDate,
    });

    const result = (await generateTrainingPlanTool.execute(
      {
        raceType: "marathon",
        raceDate: laterDate,
        raceId: first,
        secondRaceId: second,
        daysPerWeek: 5,
        hoursPerWeek: 8,
      },
      { userId: USER, db }
    )) as { success: boolean; preview: { race: { id: string | null } } };

    expect(result.success).toBe(true);
    expect(result.preview.race.id).toBe(second);
  });

  it("refuses with coach-facing text when the second race is not A-priority", async () => {
    const laterDate = addDaysYmd(FIRST_DATE, 60);
    const first = await makeRace({
      name: "Spring A-Race",
      raceType: "marathon",
      date: FIRST_DATE,
    });
    const second = await makeRace({
      name: "Fall B-Race",
      raceType: "marathon",
      date: laterDate,
      priority: "B",
    });

    const result = await generateTrainingPlanTool.execute(
      {
        raceType: "marathon",
        raceDate: laterDate,
        raceId: first,
        secondRaceId: second,
        daysPerWeek: 5,
        hoursPerWeek: 8,
      },
      { userId: USER, db }
    );

    expect(result).toEqual({
      success: false,
      reason: "second_race_not_a",
      error: REFUSAL_TEXT.second_race_not_a,
    });
  });

  it("the secondRaceId parameter is an optional uuid", () => {
    const schema_ = generateTrainingPlanTool.parameters;
    expect(
      schema_.safeParse({
        raceType: "marathon",
        raceDate: FIRST_DATE,
        secondRaceId: "not-a-uuid",
      }).success
    ).toBe(false);
    expect(
      schema_.safeParse({
        raceType: "marathon",
        raceDate: FIRST_DATE,
      }).success
    ).toBe(true);
  });
});

describe("generate_training_plan — malformed two-race arguments", () => {
  it("refuses a second race with no first, instead of silently targeting it", async () => {
    // Before this guard the lone id fell through to the one-target branch,
    // which runs no A-priority check, so the coach got a plausible
    // single-race plan for a race it never asked to target alone.
    const result = (await generateTrainingPlanTool.execute(
      {
        raceType: "marathon",
        raceDate: "2026-10-11",
        daysPerWeek: 5,
        hoursPerWeek: 8,
        secondRaceId: "11111111-1111-4111-8111-111111111111",
      },
      { userId: "malformed-args-no-db-needed", db }
    )) as { success: boolean; reason: string; error: string };
    expect(result.success).toBe(false);
    expect(result.reason).toBe("second_race_without_first");
  });

  it("refuses the same race twice with a sentence that is true", async () => {
    // Previously this refused as `race_not_found` -- "That race is not on
    // your calendar any more" -- which is simply untrue: it is on the
    // calendar, it was just named twice.
    const id = "22222222-2222-4222-8222-222222222222";
    const result = (await generateTrainingPlanTool.execute(
      {
        raceType: "marathon",
        raceDate: "2026-10-11",
        daysPerWeek: 5,
        hoursPerWeek: 8,
        raceId: id,
        secondRaceId: id,
      },
      { userId: "malformed-args-no-db-needed", db }
    )) as { success: boolean; reason: string; error: string };
    expect(result.success).toBe(false);
    expect(result.reason).toBe("same_race_twice");
    expect(result.error).not.toMatch(/not on your calendar/);
  });
});
