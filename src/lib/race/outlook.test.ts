import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { DaySlot } from "@/lib/week-plan/types";
import { raceCard, simulateRaceForm, weeksFromDays } from "./outlook";

// requires Postgres; skips without DATABASE_URL.
const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

const NO_RACE = "test-outlook-no-race";
const NO_PLAN = "test-outlook-no-plan";
const NO_LOAD = "test-outlook-no-load";
const CAPPED = "test-outlook-capped";
const INDOOR_FTP = "test-race-card-indoor-ftp-user";
const ALL_USERS = [NO_RACE, NO_PLAN, NO_LOAD, CAPPED, INDOOR_FTP];

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
    await db
      .delete(schema.bodyPrefs)
      .where(inArray(schema.bodyPrefs.userId, ALL_USERS));
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

  it("uses indoor FTP for race pacing when outdoor is unset", async () => {
    const userId = INDOOR_FTP;
    await seedUser(userId);
    await db.insert(schema.races).values({
      userId,
      name: "Test Bike Race",
      raceType: "gran_fondo",
      sport: "Bike",
      date: "2026-12-01",
      priority: "A",
      distanceKm: 90,
      elevationM: 900,
    });
    await db.insert(schema.bodyPrefs).values({
      userId,
      ftpWatts: null,
      ftpWattsIndoor: 235,
    });

    const card = await raceCard(userId, new Date("2026-08-01"));
    expect(card.pacing?.available).toBe(true);
    if (!card.pacing?.available) return;
    expect(card.pacing.confidence).toBe("low");
    expect(card.pacing.why).toMatch(/indoor/i);
    // Cleanup: the shared afterAll deletes races/bodyPrefs/users for every id
    // in ALL_USERS, including INDOOR_FTP, unconditionally on pass or fail.
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

// Pure arithmetic — no DB, runs even without DATABASE_URL.
describe("weeksFromDays", () => {
  // The regression this exists to fix (task 6a, carried from slice 1):
  // Math.round(32 / 7) is 5 — "5 weeks to race" at 4 weeks 4 days out — an
  // overstatement, and it runs in exactly the direction that hurts a
  // taper. Math.floor(32 / 7) is 4, the true count of whole weeks left.
  it("rounds DOWN, not to the nearest week", () => {
    expect(weeksFromDays(32)).toBe(4);
    expect(weeksFromDays(32)).not.toBe(Math.round(32 / 7));
  });

  // The four boundaries the brief calls out, 28/31/32/34 days out — all
  // read "4 weeks" (4 whole weeks elapsed, some remainder of days short of
  // a 5th), unlike Math.round, which flips to 5 at 32 and stays there
  // through 34.
  it("28 days (exactly 4 weeks) reads 4", () => {
    expect(weeksFromDays(28)).toBe(4);
  });

  it("31 days (4 weeks 3 days, just under the old rounding's half-week flip) reads 4", () => {
    expect(weeksFromDays(31)).toBe(4);
  });

  it("32 days (4 weeks 4 days, exactly where Math.round used to flip to 5) reads 4", () => {
    expect(weeksFromDays(32)).toBe(4);
  });

  it("34 days (4 weeks 6 days, one day short of a real 5th week) still reads 4", () => {
    expect(weeksFromDays(34)).toBe(4);
  });

  // Not just stuck at 4 — the boundary above it still moves.
  it("35 days (exactly 5 weeks) reads 5", () => {
    expect(weeksFromDays(35)).toBe(5);
  });

  it("0 days out reads 0 weeks", () => {
    expect(weeksFromDays(0)).toBe(0);
  });
});
