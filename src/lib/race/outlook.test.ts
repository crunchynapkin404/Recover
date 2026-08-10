import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { DaySlot } from "@/lib/week-plan/types";
import { raceCard, simulateRaceForm } from "./outlook";

// requires Postgres; skips without DATABASE_URL.
const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

const NO_RACE = "test-outlook-no-race";
const NO_PLAN = "test-outlook-no-plan";
const NO_LOAD = "test-outlook-no-load";
const CAPPED = "test-outlook-capped";
const ALL_USERS = [NO_RACE, NO_PLAN, NO_LOAD, CAPPED];

const WEEK_START = "2026-07-20"; // Monday
const NOW = new Date("2026-07-22T09:00:00"); // Wednesday of that week

// Copied verbatim from service.test.ts lines 15-32.
function emptyWeek(weekStart: string): DaySlot[] {
  const days: DaySlot[] = [];
  const d = new Date(weekStart + "T00:00:00");
  for (let i = 0; i < 7; i++) {
    const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    days.push({
      date: ymd,
      availableBlocks: [
        { start: null, end: null, mins: 60, energy: "normal", sports: null },
      ],
      availableMins: 60,
      workouts: [],
      status: "rest",
    });
    d.setDate(d.getDate() + 1);
  }
  return days;
}

async function seedUser(id: string) {
  await db
    .insert(schema.users)
    .values({ id, name: id, email: `${id}@example.invalid` })
    .onConflictDoNothing();
}

async function seedRace(userId: string, date: string) {
  await db.insert(schema.races).values({
    userId,
    name: "Test Race",
    raceType: "marathon",
    sport: "Run",
    date,
    priority: "A",
  });
}

/** Plan + one block + an open week. Returns the plan id for teardown. */
async function seedPlan(userId: string, raceDate: string): Promise<string> {
  const [plan] = await db
    .insert(schema.trainingPlans)
    .values({
      userId,
      title: "Test Plan",
      raceType: "marathon",
      raceDate,
      startDate: "2026-07-20",
      weeksTotal: 1,
      currentWeek: 1,
      status: "active",
    })
    .returning();
  await db.insert(schema.trainingBlocks).values({
    planId: plan.id,
    weekNumber: 1,
    phase: "base",
    targetLoadTotal: 300,
    targetSessions: 4,
    workouts: [],
  });
  await db.insert(schema.weekPlans).values({
    userId,
    planId: plan.id,
    weekStart: WEEK_START,
    skeletonWeek: 1,
    days: emptyWeek(WEEK_START),
    status: "open",
    effectiveTarget: 300,
  });
  return plan.id;
}

describe.skipIf(!hasDb)("raceCard", () => {
  const planIds: string[] = [];

  beforeAll(async () => {
    for (const u of ALL_USERS) await seedUser(u);

    // NO_RACE: user only.

    // NO_PLAN: a race, but nothing planning for it.
    await seedRace(NO_PLAN, "2026-08-15");

    // NO_LOAD: race + plan + open week, but no daily_metrics row, so
    // assembleForecastInputs yields start == null.
    await seedRace(NO_LOAD, "2026-08-15");
    planIds.push(await seedPlan(NO_LOAD, "2026-08-15"));

    // CAPPED: same, plus ctl/atl, and a race date well beyond the single
    // planned week — so horizonEnd < targetDate and capped is true.
    await seedRace(CAPPED, "2026-10-01");
    planIds.push(await seedPlan(CAPPED, "2026-10-01"));
    await db
      .insert(schema.dailyMetrics)
      .values({ userId: CAPPED, date: "2026-07-21", ctl: 40, atl: 35 })
      .onConflictDoNothing();
  });

  afterAll(async () => {
    await db
      .delete(schema.weekPlans)
      .where(inArray(schema.weekPlans.userId, ALL_USERS));
    await db
      .delete(schema.trainingBlocks)
      .where(inArray(schema.trainingBlocks.planId, planIds));
    await db
      .delete(schema.trainingPlans)
      .where(inArray(schema.trainingPlans.userId, ALL_USERS));
    await db
      .delete(schema.dailyMetrics)
      .where(inArray(schema.dailyMetrics.userId, ALL_USERS));
    await db
      .delete(schema.races)
      .where(inArray(schema.races.userId, ALL_USERS));
    await db.delete(schema.users).where(inArray(schema.users.id, ALL_USERS));
  });

  it("returns a null card when the athlete has no upcoming race", async () => {
    const card = await raceCard(NO_RACE, NOW);
    expect(card.race).toBeNull();
    expect(card.daysOut).toBeNull();
    expect(card.outlook).toBeNull();
  });

  it("reports a missing plan, not a missing figure", async () => {
    const card = await raceCard(NO_PLAN, NOW);
    expect(card.outlook?.available).toBe(false);
    if (card.outlook?.available !== false) return;
    expect(card.outlook.kind).toBe("missing_input");
    if (card.outlook.kind !== "missing_input") return;
    expect(card.outlook.needs).toBe("an active training plan");
  });

  it("reports missing training-load history, not a fabricated zero", async () => {
    const card = await raceCard(NO_LOAD, NOW);
    expect(card.outlook?.available).toBe(false);
    if (card.outlook?.available !== false) return;
    expect(card.outlook.kind).toBe("missing_input");
    if (card.outlook.kind !== "missing_input") return;
    expect(card.outlook.needs).toBe("training-load history");
  });

  it("qualifies a projection that stops before race day", async () => {
    const card = await raceCard(CAPPED, NOW);
    expect(card.outlook?.available).toBe(true);
    if (card.outlook?.available !== true) return;
    expect(card.outlook.value.capped).toBe(true);
    expect(card.outlook.why).toContain("plan end");
    expect(card.outlook.confidence).toBe("low");
  });

  it("counts days out from the date given, not wall-clock now", async () => {
    const card = await raceCard(NO_LOAD, NOW);
    // 2026-07-22 → 2026-08-15
    expect(card.daysOut).toBe(24);
  });

  describe("simulateRaceForm", () => {
    it("reports missing load history rather than a fabricated comparison", async () => {
      const r = await simulateRaceForm(NO_LOAD, {
        kind: "skip",
        fromDate: "2026-07-22",
      });
      expect(r.available).toBe(false);
      if (r.available) return;
      expect(r.kind).toBe("missing_input");
      if (r.kind !== "missing_input") return;
      expect(r.needs).toBe("training-load history");
    });

    it("carries capped through to the caller", async () => {
      const r = await simulateRaceForm(CAPPED, {
        kind: "skip",
        fromDate: "2026-07-22",
      });
      expect(r.available).toBe(true);
      if (!r.available) return;
      expect(r.value.capped).toBe(true);
    });
  });
});
