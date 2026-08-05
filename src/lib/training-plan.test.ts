import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import {
  generateWorkouts,
  generateCyclingWorkouts,
  withPurpose,
  PURPOSE_BY_TYPE,
  generateTrainingPlan,
  longRideBoundMins,
  distributeRemainder,
  periodize,
  EASY_RUN_CAP_MINS,
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
    const ws = generateWorkouts(4, 8, "build", "Bike");
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

  it("is a no-op for an empty input", () => {
    expect(distributeRemainder([], [], 50)).toEqual([]);
  });

  it("is a no-op when every bound is already below current", () => {
    // No session has headroom, so the remainder cannot be placed anywhere —
    // the loop must recognize this on the first pass and stop, not loop
    // forever or push values past bounds already violated coming in.
    expect(distributeRemainder([100, 100], [90, 90], 50)).toEqual([100, 100]);
  });
});

describe("generateCyclingWorkouts distributes the target", () => {
  function total(ws: { durationMins: number }[]): number {
    return ws.reduce((s, w) => s + w.durationMins, 0);
  }

  it("schedules the whole target — the live regression", () => {
    // Owner account, skeleton week 5, build phase: 12.5h target x the 1.03
    // build multiplier = 772.5 -> 773 min. This produced 559 min before
    // the fix (long clamped 294->240, two endurance rides clamped 197->90).
    const ws = generateCyclingWorkouts(
      4,
      12.5 * 1.03,
      "build",
      4.897963084361944
    );
    expect(total(ws)).toBe(773);
  });

  it("puts the long ride at the event's hardest day, not a constant", () => {
    const ws = generateCyclingWorkouts(
      4,
      12.5 * 1.03,
      "build",
      4.897963084361944
    );
    const long = ws.find((w) => w.type === "Long");
    expect(long?.durationMins).toBe(294);
  });

  it("leaves the intensity session out of redistribution", () => {
    // 18% of 773 = 139. It must not grow to soak up volume: duration at
    // intensity is prescribed, not filler.
    const ws = generateCyclingWorkouts(
      4,
      12.5 * 1.03,
      "build",
      4.897963084361944
    );
    const hard = ws.find((w) => w.type === "Intervals");
    expect(hard?.durationMins).toBe(139);
  });

  it("still fills the target with no event demand, using today's cap", () => {
    // periodize(9, 76.7, 4, 10, ...) week 5: 10h x 1.03 = 618 min.
    // Long = round(618 x 0.38) = 235, under the 240 no-demand bound.
    const ws = generateCyclingWorkouts(4, 10 * 1.03, "build", null);
    expect(total(ws)).toBe(618);
    expect(ws.find((w) => w.type === "Long")?.durationMins).toBe(235);
  });

  it("keeps the taper's shortened long ride", () => {
    const ws = generateCyclingWorkouts(4, 8, "taper", 4.897963084361944);
    expect(ws.find((w) => w.type === "Long")?.durationMins).toBe(90);
  });

  it("falls short only when every participating session is at its bound", () => {
    // 2 sessions against an impossible 20h target, with a criterium's queen
    // stage bounding the ride at 120. Long pins at 120 and there are no
    // endurance rides to absorb anything, so the week legitimately comes in
    // short — that is a real "these days cannot absorb this", not a
    // discarded remainder.
    //
    // Tempo is NOT bounded by longBound: it is 18% of the target by
    // prescription (round(1200 × 0.18) = 216) and is excluded from
    // redistribution, so assert only the participating sessions.
    const ws = generateCyclingWorkouts(2, 20, "base", 0.5);
    expect(total(ws)).toBeLessThan(20 * 60);

    const participating = ws.filter(
      (w) => w.type !== "Intervals" && w.type !== "Tempo"
    );
    expect(participating.length).toBeGreaterThan(0);
    for (const w of participating) {
      expect(w.durationMins).toBeLessThanOrEqual(120);
    }
    expect(ws.find((w) => w.type === "Long")?.durationMins).toBe(120);
  });

  it("never drops an easy ride below the effective floor", () => {
    const ws = generateCyclingWorkouts(5, 2, "base", null);
    for (const w of ws.filter((x) => x.type === "Endurance")) {
      expect(w.durationMins).toBeGreaterThanOrEqual(30);
    }
  });

  // The cases above all happen to leave `remainder <= 0`, because `easyMins`
  // divides by `remaining` AFTER the long ride is clamped and so absorbs the
  // clamped minutes implicitly. Redistribution only has work to do when the
  // endurance loop creates FEWER rides than `remaining` — it runs
  // `min(remaining, availDays.length)` times against 5 available days. The two
  // cases below are the ones that actually execute it; without them a
  // regression in the participant mapping, the bounds array or the write-back
  // would pass the whole suite.

  it("grows sessions with headroom instead of discarding the remainder", () => {
    // 7 sessions, 20h, recovery: totalMins 1200, long clamped to its 240
    // bound, `remaining` 6 against 5 available days, so `easyMins` is
    // round(960/6) = 160 and only five rides are created — 1040 scheduled,
    // 160 left over. The long ride is already at its bound and takes none of
    // it; the five recovery rides each gain 32.
    const ws = generateCyclingWorkouts(7, 20, "recovery", null);

    expect(total(ws)).toBe(1200);
    // 192, not the 160 they were first sized at — this is the assertion that
    // observes redistribution doing work rather than returning its input.
    for (const w of ws.filter((x) => x.type === "Recovery")) {
      expect(w.durationMins).toBe(192);
    }
    expect(ws.find((w) => w.type === "Long")?.durationMins).toBe(240);
  });

  it("holds the intensity session flat while the rest absorb the remainder", () => {
    // Same shape in build, where an Intervals session exists: totalMins 1200,
    // long 240, intervals round(1200 x 0.18) = 216, `remaining` 6 against 5
    // days -> easyMins round(744/6) = 124, 1076 scheduled, 124 left over. The
    // five endurance rides take an even 24 each, then the 4-minute leftover
    // goes out one at a time: 149/149/149/149/148.
    //
    // Unlike the earlier exclusion test, `remainder` here is non-zero and the
    // block genuinely executes, so this fails if `participants` ever stops
    // filtering intensity sessions out.
    const ws = generateCyclingWorkouts(8, 20, "build", null);

    expect(total(ws)).toBe(1200);
    expect(ws.find((w) => w.type === "Intervals")?.durationMins).toBe(216);

    const easy = ws
      .filter((w) => w.type === "Endurance")
      .map((w) => w.durationMins)
      .sort((a, b) => b - a);
    expect(easy).toEqual([149, 149, 149, 149, 148]);
  });
});

describe("periodize passes event demand to the cycling generator", () => {
  it("bounds the long ride by the event's hardest day", () => {
    const withDemand = periodize(9, 76.7, 4, 12.5, "Bike", 4.897963084361944);
    const withoutDemand = periodize(9, 76.7, 4, 12.5, "Bike");

    const longOf = (blocks: ReturnType<typeof periodize>) =>
      blocks
        .find((b) => b.weekNumber === 5)!
        .workouts.find((w) => w.type === "Long")!.durationMins;

    // 12.5h x 1.03 = 773 min; 38% = 294, which the event allows and the
    // 240 no-demand fallback does not.
    expect(longOf(withDemand)).toBe(294);
    expect(longOf(withoutDemand)).toBe(240);
  });
});

describe("EASY_RUN_CAP_MINS", () => {
  it("bounds the generator's easy runs", () => {
    // 20 hours across 6 sessions is far more than the easy-run cap can hold,
    // so every easy run the fill loop places must be pinned at the cap.
    // Filtered by description, not by type: the Thursday session is also
    // typed "Endurance" outside build/peak and is deliberately NOT capped —
    // it is sized as a fraction of the week, not by the easy-run rule.
    const workouts = generateWorkouts(6, 20, "base", "Run");
    const easy = workouts.filter((w) => w.description === "Easy aerobic run");

    expect(easy.length).toBeGreaterThan(0);
    for (const w of easy) {
      expect(w.durationMins).toBe(EASY_RUN_CAP_MINS);
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

describe("generateWorkouts dispatches on sport alone", () => {
  it("builds cycling for Bike", () => {
    const w = generateWorkouts(4, 10, "base", "Bike");
    expect(w.length).toBeGreaterThan(0);
    expect(w.every((x) => x.sport === "Bike")).toBe(true);
  });

  it("builds running for Run", () => {
    const w = generateWorkouts(4, 10, "base", "Run");
    expect(w.every((x) => x.sport === "Run")).toBe(true);
  });

  it("builds triathlon — including swim — for Triathlon", () => {
    const w = generateWorkouts(5, 10, "base", "Triathlon");
    const sports = new Set(w.map((x) => x.sport));
    expect(sports.has("Swim")).toBe(true);
    expect(sports.has("Bike")).toBe(true);
    expect(sports.has("Run")).toBe(true);
  });

  it("throws on a sport it cannot build, instead of producing running", () => {
    // The v0.42 defect in one assertion: every one of these used to return
    // a running plan. `as never` because the type now forbids them — the
    // cast proves the RUNTIME guard, for callers reaching this from JSON.
    //
    // "Ride" is deliberately NOT in this list: requirePlanSport canonicalises
    // provider words, so requirePlanSport("Ride") === "Bike" by design (see
    // plan-sport.test.ts). That is load-bearing — the live rollover calls
    // requirePlanSport(constraints.sports?.[0]), and a real production plan
    // stores constraints.sports as ["Ride"]. "Completing" this list by adding
    // "Ride" back would make that plan's weekly rollover throw.
    for (const bad of ["Swim", "Tennis", "", null]) {
      expect(() => generateWorkouts(4, 10, "base", bad as never)).toThrow(
        /unsupported plan sport/
      );
    }
  });
});
