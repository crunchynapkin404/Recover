import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import {
  addDaysYmd,
  applyResolvedAvailability,
  getOpenWeekPlan,
  mondayOf,
  moveWorkout,
  nextReentryStage,
  planConstraints,
  planWeekOf,
  rolloverWeekPlan,
  runDailyAdaptation,
  swapWorkouts,
} from "./service";
import { bookDayLoad } from "./actuals";
import { blockFits } from "./types";
import type { DaySlot, ScheduledWorkout } from "./types";
import { withPurpose } from "@/lib/training-plan";
import type { AvailabilityBlock } from "@/lib/availability/types";

// requires Postgres; skips without DATABASE_URL.
const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

const TEST_USER = "test-week-plan-service-user";
const WEEK_START = "2026-07-20"; // Monday

function blk(
  mins: number,
  energy: AvailabilityBlock["energy"] = "full"
): AvailabilityBlock {
  return { start: null, end: null, mins, energy, sports: null };
}

function sw(o: Partial<ScheduledWorkout> = {}): ScheduledWorkout {
  return withPurpose({
    day: 0,
    sport: "Run",
    type: "Endurance",
    durationMins: 45,
    intensity: "Z1-Z2",
    description: "Easy run",
    blockIdx: 0,
    ...o,
  });
}

function emptyDay(
  date: string,
  blocks: AvailabilityBlock[] = [blk(60)]
): DaySlot {
  return {
    date,
    availableBlocks: blocks,
    availableMins: blocks.reduce((s, b) => s + b.mins, 0),
    workouts: [],
    status: "rest",
  };
}

function weekDates(): string[] {
  const out: string[] = [];
  const d = new Date(WEEK_START + "T00:00:00");
  for (let i = 0; i < 7; i++) {
    out.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
        d.getDate()
      ).padStart(2, "0")}`
    );
    d.setDate(d.getDate() + 1);
  }
  return out;
}
const DATES = weekDates();

describe("nextReentryStage", () => {
  it("advances week_1 to week_2", () => {
    expect(nextReentryStage("week_1")).toBe("week_2");
  });

  it("advances week_2 to none", () => {
    expect(nextReentryStage("week_2")).toBe("none");
  });

  it("keeps none at none", () => {
    expect(nextReentryStage("none")).toBe("none");
  });
});

describe("planConstraints", () => {
  it("defaults to balanced/normal/none", () => {
    expect(planConstraints(null)).toMatchObject({
      planStyle: "balanced",
      seasonMode: "normal",
      reentryStage: "none",
    });
  });

  it("normal season mode forces reentry none", () => {
    expect(
      planConstraints({
        planStyle: "block_lite",
        seasonMode: "normal",
        reentryStage: "week_1",
      })
    ).toMatchObject({
      planStyle: "block_lite",
      seasonMode: "normal",
      reentryStage: "none",
    });
  });

  it("keeps off-season reentry stage when valid", () => {
    expect(
      planConstraints({
        planStyle: "block_lite",
        seasonMode: "off_season",
        reentryStage: "week_2",
      })
    ).toMatchObject({
      planStyle: "block_lite",
      seasonMode: "off_season",
      reentryStage: "week_2",
    });
  });
});

/**
 * Task 5, fix round 1: `firstRace.weekNumber` at both live `periodize()`
 * call sites used to be `Math.ceil(daysBetween / 7)`, which undercounts by
 * one at every exact multiple of 7 — i.e. whenever the race falls on the
 * same weekday `plan.startDate` did. Week N spans days `7(N-1)..7N-1` from
 * `startDate`, so a race exactly 7 days out is in week 2, not week 1. Pure
 * — no database involved, so this isn't gated on `hasDb`.
 */
describe("planWeekOf", () => {
  const START = "2026-01-05"; // Monday

  it.each([
    [6, 1],
    [7, 2],
    [8, 2],
    [13, 2],
    [14, 3],
  ])("day offset %i from plan.startDate is week %i", (offset, week) => {
    expect(planWeekOf(START, addDaysYmd(START, offset))).toBe(week);
  });
});

/**
 * Task 10: an activity's load always lands somewhere, but only a day WITH a
 * planned session may book it as `actualLoad` — a day with none (a rest day,
 * or a day whose session was already pulled elsewhere) must book it as
 * `unplannedLoad` instead, so it counts toward the week's totals without
 * ever reading as "this session's actual" and without ever triggering a
 * replan. Pure — no database involved, so this isn't gated on `hasDb`.
 */
describe("bookDayLoad", () => {
  it("books load on a day with no planned session as unplanned", () => {
    const d = bookDayLoad(emptyDay(DATES[0]), 55);
    expect(d.unplannedLoad).toBe(55);
    expect(d.actualLoad).toBeUndefined();
    expect(d.status).toBe("rest");
    expect(d.workouts).toHaveLength(0);
  });

  it("books load on a planned day as the session's actual", () => {
    const planned: DaySlot = {
      ...emptyDay(DATES[0]),
      status: "planned",
      workouts: [sw({ sport: "Bike", durationMins: 60 })],
    };
    const d = bookDayLoad(planned, 55);
    expect(d.actualLoad).toBe(55);
    expect(d.unplannedLoad).toBeUndefined();
  });

  it("never removes a workout, even when the activity's load far exceeds what was planned", () => {
    const planned: DaySlot = {
      ...emptyDay(DATES[0]),
      status: "planned",
      workouts: [sw({ sport: "Bike", type: "Intervals", durationMins: 90 })],
    };
    const d = bookDayLoad(planned, 400);
    expect(d.workouts).toHaveLength(1);
    expect(d.workouts[0].durationMins).toBe(90);
    expect(d.actualLoad).toBe(400);
  });

  it("SETS the day's unplanned total rather than accumulating, so re-running never doubles it", () => {
    // The caller passes the day's recomputed total, not an increment. An
    // accumulating version needed an "already seen this activity" guard to
    // stay idempotent, and that guard is what stopped a second ride on the
    // same day from ever being counted.
    const once = bookDayLoad(emptyDay(DATES[0]), 30);
    const twice = bookDayLoad(once, 30);
    expect(twice.unplannedLoad).toBe(30);
  });
});

/**
 * Task 9b: moveWorkout and swapWorkouts must pick whichever block on the
 * destination day actually admits the session — never carry the origin's
 * blockIdx across unchecked, and never decide fit with a day-level "does
 * some block work?" question.
 */
describe.skipIf(!hasDb)(
  "moveWorkout / swapWorkouts — block-aware placement (Task 9b)",
  () => {
    let planId: string;

    beforeAll(async () => {
      await db
        .insert(schema.users)
        .values({
          id: TEST_USER,
          name: "Test Week Plan Service User",
          email: `${TEST_USER}@example.invalid`,
        })
        .onConflictDoNothing();

      const [plan] = await db
        .insert(schema.trainingPlans)
        .values({
          userId: TEST_USER,
          title: "Test Plan",
          raceType: "marathon",
          raceDate: "2026-12-01",
          startDate: "2026-01-01",
          weeksTotal: 16,
          currentWeek: 1,
          status: "active",
        })
        .returning();
      planId = plan.id;
    });

    afterAll(async () => {
      await db
        .delete(schema.weekPlans)
        .where(eq(schema.weekPlans.userId, TEST_USER));
      await db
        .delete(schema.trainingPlans)
        .where(eq(schema.trainingPlans.userId, TEST_USER));
      await db.delete(schema.users).where(eq(schema.users.id, TEST_USER));
    });

    beforeEach(async () => {
      await db
        .delete(schema.weekPlans)
        .where(eq(schema.weekPlans.userId, TEST_USER));
    });

    async function seedWeek(days: DaySlot[]): Promise<void> {
      await db.insert(schema.weekPlans).values({
        userId: TEST_USER,
        planId,
        weekStart: WEEK_START,
        skeletonWeek: 1,
        days,
        status: "open",
        effectiveTarget: 300,
      });
    }

    it("moveWorkout onto a day whose only fitting block is not index 0", async () => {
      const days = DATES.map((d) => emptyDay(d));
      days[0].availableBlocks = [blk(90)];
      days[0].workouts = [sw({ durationMins: 90, blockIdx: 0 })];
      days[0].status = "planned";
      // Destination's only fitting block sits at index 1 — the 20min block
      // at index 0 (the carried index) is too small.
      days[1].availableBlocks = [blk(20), blk(120)];
      await seedWeek(days);

      const result = await moveWorkout(TEST_USER, DATES[0], DATES[1]);
      expect(result).toBe("moved");

      const week = await getOpenWeekPlan(TEST_USER);
      const dest = week!.days[1];
      expect(dest.workouts).toHaveLength(1);
      expect(dest.workouts[0].blockIdx).toBe(1);
      expect(
        blockFits(
          dest,
          dest.workouts[0].blockIdx,
          dest.workouts[0].durationMins
        )
      ).toBe(true);
    });

    it("moveWorkout refuses a day where the only large-enough block is already occupied", async () => {
      const days = DATES.map((d) => emptyDay(d));
      days[0].availableBlocks = [blk(90)];
      days[0].workouts = [sw({ durationMins: 90, blockIdx: 0 })];
      days[0].status = "planned";
      days[1].availableBlocks = [blk(20), blk(120)];
      days[1].workouts = [sw({ durationMins: 100, blockIdx: 1 })];
      days[1].status = "planned";
      await seedWeek(days);

      const result = await moveWorkout(TEST_USER, DATES[0], DATES[1]);
      expect(result).toBe("invalid");

      // Not silently double-booked: the destination day is untouched.
      const week = await getOpenWeekPlan(TEST_USER);
      expect(week!.days[1].workouts).toHaveLength(1);
      expect(week!.days[1].workouts[0].blockIdx).toBe(1);
    });

    it("moveWorkout corrects blockIdx to 0 when the destination day has fewer blocks than the carried index", async () => {
      const days = DATES.map((d) => emptyDay(d));
      days[0].availableBlocks = [blk(60), blk(90)];
      days[0].workouts = [sw({ durationMins: 80, blockIdx: 1 })];
      days[0].status = "planned";
      // Destination has a single block — the carried index (1) points at
      // nothing there, but block 0 plainly fits.
      days[1].availableBlocks = [blk(90)];
      await seedWeek(days);

      const result = await moveWorkout(TEST_USER, DATES[0], DATES[1]);
      expect(result).toBe("moved");

      const week = await getOpenWeekPlan(TEST_USER);
      const dest = week!.days[1];
      expect(dest.workouts[0].blockIdx).toBe(0);
      expect(
        blockFits(
          dest,
          dest.workouts[0].blockIdx,
          dest.workouts[0].durationMins
        )
      ).toBe(true);
    });

    it("swapWorkouts keeps both sessions in blocks that fit them, correcting each carried index", async () => {
      const days = DATES.map((d) => emptyDay(d));
      // Monday: a small 20min block and a roomy 150min sibling. Its own
      // 45min session sits in the roomy one (blockIdx 1).
      days[0].availableBlocks = [blk(20), blk(150)];
      days[0].workouts = [sw({ durationMins: 45, blockIdx: 1 })];
      days[0].status = "planned";
      // Thursday: a roomy 100min block and a tiny 10min sibling. Its own
      // 80min session sits in the roomy one (blockIdx 0).
      days[3].availableBlocks = [blk(100), blk(10)];
      days[3].workouts = [sw({ durationMins: 80, blockIdx: 0 })];
      days[3].status = "planned";
      await seedWeek(days);

      const result = await swapWorkouts(TEST_USER, DATES[0], DATES[3]);
      expect(result).toBe("swapped");

      const week = await getOpenWeekPlan(TEST_USER);
      const mon = week!.days[0];
      const thu = week!.days[3];

      // Thursday's 80min session, carried index 0, must land in Monday's
      // 150min block (index 1) — its own 20min block at index 0 is too small.
      expect(mon.workouts[0].durationMins).toBe(80);
      expect(mon.workouts[0].blockIdx).toBe(1);
      expect(
        blockFits(mon, mon.workouts[0].blockIdx, mon.workouts[0].durationMins)
      ).toBe(true);

      // Monday's 45min session, carried index 1, must land in Thursday's
      // 100min block (index 0) — its own 10min block at index 1 is too small.
      expect(thu.workouts[0].durationMins).toBe(45);
      expect(thu.workouts[0].blockIdx).toBe(0);
      expect(
        blockFits(thu, thu.workouts[0].blockIdx, thu.workouts[0].durationMins)
      ).toBe(true);
    });
  }
);

/**
 * Task 9c, finding 2: a day can now genuinely hold two sessions
 * (MAX_SESSIONS_PER_DAY). moveWorkout/swapWorkouts only ever read/wrote
 * workouts[0], so the second session on such a day was silently discarded.
 * The fix is conservative: refuse the operation ("invalid") rather than try
 * to guess which of the two sessions the caller meant.
 */
describe.skipIf(!hasDb)(
  "moveWorkout / swapWorkouts — refuse multi-session days (Task 9c)",
  () => {
    let planId: string;

    beforeAll(async () => {
      await db
        .insert(schema.users)
        .values({
          id: TEST_USER,
          name: "Test Week Plan Service User",
          email: `${TEST_USER}@example.invalid`,
        })
        .onConflictDoNothing();

      const [plan] = await db
        .insert(schema.trainingPlans)
        .values({
          userId: TEST_USER,
          title: "Test Plan",
          raceType: "marathon",
          raceDate: "2026-12-01",
          startDate: "2026-01-01",
          weeksTotal: 16,
          currentWeek: 1,
          status: "active",
        })
        .returning();
      planId = plan.id;
    });

    afterAll(async () => {
      await db
        .delete(schema.weekPlans)
        .where(eq(schema.weekPlans.userId, TEST_USER));
      await db
        .delete(schema.trainingPlans)
        .where(eq(schema.trainingPlans.userId, TEST_USER));
      await db.delete(schema.users).where(eq(schema.users.id, TEST_USER));
    });

    beforeEach(async () => {
      await db
        .delete(schema.weekPlans)
        .where(eq(schema.weekPlans.userId, TEST_USER));
    });

    async function seedWeek(days: DaySlot[]): Promise<void> {
      await db.insert(schema.weekPlans).values({
        userId: TEST_USER,
        planId,
        weekStart: WEEK_START,
        skeletonWeek: 1,
        days,
        status: "open",
        effectiveTarget: 300,
      });
    }

    it("moveWorkout refuses when the source day holds two sessions, leaving both untouched", async () => {
      const days = DATES.map((d) => emptyDay(d));
      days[0].availableBlocks = [blk(45), blk(60)];
      days[0].workouts = [
        sw({ durationMins: 40, blockIdx: 0 }),
        sw({ durationMins: 50, blockIdx: 1 }),
      ];
      days[0].status = "planned";
      days[1].availableBlocks = [blk(90)]; // empty, would otherwise admit a move
      await seedWeek(days);

      const result = await moveWorkout(TEST_USER, DATES[0], DATES[1]);
      expect(result).toBe("invalid");

      const week = await getOpenWeekPlan(TEST_USER);
      expect(week!.days[0].workouts).toHaveLength(2);
      expect(week!.days[0].workouts[0].durationMins).toBe(40);
      expect(week!.days[0].workouts[1].durationMins).toBe(50);
      expect(week!.days[1].workouts).toHaveLength(0);
    });

    it("moveWorkout refuses when the destination day holds two sessions, leaving both untouched", async () => {
      const days = DATES.map((d) => emptyDay(d));
      days[0].availableBlocks = [blk(60)];
      days[0].workouts = [sw({ durationMins: 45, blockIdx: 0 })];
      days[0].status = "planned";
      days[1].availableBlocks = [blk(45), blk(60)];
      days[1].workouts = [
        sw({ durationMins: 40, blockIdx: 0 }),
        sw({ durationMins: 50, blockIdx: 1 }),
      ];
      days[1].status = "planned";
      await seedWeek(days);

      const result = await moveWorkout(TEST_USER, DATES[0], DATES[1]);
      expect(result).toBe("invalid");

      const week = await getOpenWeekPlan(TEST_USER);
      expect(week!.days[0].workouts).toHaveLength(1);
      expect(week!.days[0].workouts[0].durationMins).toBe(45);
      expect(week!.days[1].workouts).toHaveLength(2);
      expect(week!.days[1].workouts[0].durationMins).toBe(40);
      expect(week!.days[1].workouts[1].durationMins).toBe(50);
    });

    it("swapWorkouts refuses when either day holds two sessions, leaving both untouched", async () => {
      const days = DATES.map((d) => emptyDay(d));
      days[0].availableBlocks = [blk(45), blk(60)];
      days[0].workouts = [
        sw({ durationMins: 40, blockIdx: 0 }),
        sw({ durationMins: 50, blockIdx: 1 }),
      ];
      days[0].status = "planned";
      days[3].availableBlocks = [blk(60)];
      days[3].workouts = [sw({ durationMins: 45, blockIdx: 0 })];
      days[3].status = "planned";
      await seedWeek(days);

      const result = await swapWorkouts(TEST_USER, DATES[0], DATES[3]);
      expect(result).toBe("invalid");

      const week = await getOpenWeekPlan(TEST_USER);
      expect(week!.days[0].workouts).toHaveLength(2);
      expect(week!.days[0].workouts[0].durationMins).toBe(40);
      expect(week!.days[0].workouts[1].durationMins).toBe(50);
      expect(week!.days[3].workouts).toHaveLength(1);
      expect(week!.days[3].workouts[0].durationMins).toBe(45);
    });
  }
);

/**
 * Task 9c, finding 3: swapWorkouts clears both days then places one side at
 * a time, so the second placement sees the first's post-clear result — a
 * reviewer verified by hand that this correctly refuses an adjacency
 * violation and allows a legal non-adjacent swap, but no test shipped.
 */
describe.skipIf(!hasDb)(
  "swapWorkouts — quality adjacency regression (Task 9c)",
  () => {
    let planId: string;

    beforeAll(async () => {
      await db
        .insert(schema.users)
        .values({
          id: TEST_USER,
          name: "Test Week Plan Service User",
          email: `${TEST_USER}@example.invalid`,
        })
        .onConflictDoNothing();

      const [plan] = await db
        .insert(schema.trainingPlans)
        .values({
          userId: TEST_USER,
          title: "Test Plan",
          raceType: "marathon",
          raceDate: "2026-12-01",
          startDate: "2026-01-01",
          weeksTotal: 16,
          currentWeek: 1,
          status: "active",
        })
        .returning();
      planId = plan.id;
    });

    afterAll(async () => {
      await db
        .delete(schema.weekPlans)
        .where(eq(schema.weekPlans.userId, TEST_USER));
      await db
        .delete(schema.trainingPlans)
        .where(eq(schema.trainingPlans.userId, TEST_USER));
      await db.delete(schema.users).where(eq(schema.users.id, TEST_USER));
    });

    beforeEach(async () => {
      await db
        .delete(schema.weekPlans)
        .where(eq(schema.weekPlans.userId, TEST_USER));
    });

    async function seedWeek(days: DaySlot[]): Promise<void> {
      await db.insert(schema.weekPlans).values({
        userId: TEST_USER,
        planId,
        weekStart: WEEK_START,
        skeletonWeek: 1,
        days,
        status: "open",
        effectiveTarget: 300,
      });
    }

    // Monday: quality (Tempo). Tuesday: easy (Endurance), sandwiched between
    // Monday's quality and Wednesday's quality (Intervals) — an illegal
    // swap target for Monday's Tempo. Saturday: easy (Endurance), with no
    // quality neighbours — a legal swap target for the same session.
    function seedDays(): DaySlot[] {
      const days = DATES.map((d) => emptyDay(d));
      days[0].availableBlocks = [blk(60)];
      days[0].workouts = [sw({ type: "Tempo", durationMins: 45, blockIdx: 0 })];
      days[0].status = "planned";
      days[1].availableBlocks = [blk(60)];
      days[1].workouts = [
        sw({ type: "Endurance", durationMins: 40, blockIdx: 0 }),
      ];
      days[1].status = "planned";
      days[2].availableBlocks = [blk(60)];
      days[2].workouts = [
        sw({ type: "Intervals", durationMins: 40, blockIdx: 0 }),
      ];
      days[2].status = "planned";
      days[5].availableBlocks = [blk(60)];
      days[5].workouts = [
        sw({ type: "Endurance", durationMins: 40, blockIdx: 0 }),
      ];
      days[5].status = "planned";
      return days;
    }

    it("refuses a swap that would place a quality session adjacent to an existing quality day", async () => {
      const days = seedDays();
      await seedWeek(days);

      // Monday (Tempo) ↔ Tuesday (Endurance): Tuesday would then sit next
      // to Wednesday's Intervals — two quality days back to back.
      const result = await swapWorkouts(TEST_USER, DATES[0], DATES[1]);
      expect(result).toBe("invalid");

      const week = await getOpenWeekPlan(TEST_USER);
      expect(week!.days[0].workouts[0].type).toBe("Tempo");
      expect(week!.days[0].workouts[0].durationMins).toBe(45);
      expect(week!.days[1].workouts[0].type).toBe("Endurance");
      expect(week!.days[1].workouts[0].durationMins).toBe(40);
      expect(week!.days[2].workouts[0].type).toBe("Intervals");
    });

    it("allows a non-adjacent swap of the same shape", async () => {
      const days = seedDays();
      await seedWeek(days);

      // Monday (Tempo) ↔ Saturday (Endurance): Saturday has no quality
      // neighbours (Friday and Sunday are both rest), so this is legal.
      const result = await swapWorkouts(TEST_USER, DATES[0], DATES[5]);
      expect(result).toBe("swapped");

      const week = await getOpenWeekPlan(TEST_USER);
      const mon = week!.days[0];
      const sat = week!.days[5];
      expect(mon.workouts[0].type).toBe("Endurance");
      expect(mon.workouts[0].durationMins).toBe(40);
      expect(
        blockFits(mon, mon.workouts[0].blockIdx, mon.workouts[0].durationMins)
      ).toBe(true);
      expect(sat.workouts[0].type).toBe("Tempo");
      expect(sat.workouts[0].durationMins).toBe(45);
      expect(
        blockFits(sat, sat.workouts[0].blockIdx, sat.workouts[0].durationMins)
      ).toBe(true);
    });
  }
);

/**
 * Task 10 fix: the design states plainly that "an activity landing on a day
 * with no planned session ... is recorded as unplannedLoad" — but
 * runDailyAdaptation's activity match used to require a planned workout on
 * yesterday's slot before it would even query for a synced activity. A
 * genuine rest-day bonus ride (or a race day, whose "session" was never a
 * `workouts` entry to begin with) had no planned workout to match against,
 * so the query never ran and unplannedLoad was never written — the
 * recordUnplannedLoad branch above was only exercised by its own direct unit
 * tests, never end to end. These tests drive it through
 * runDailyAdaptation itself.
 */
describe.skipIf(!hasDb)(
  "runDailyAdaptation — activity on a day with no planned session (Task 10 fix)",
  () => {
    let planId: string;

    beforeAll(async () => {
      await db
        .insert(schema.users)
        .values({
          id: TEST_USER,
          name: "Test Week Plan Service User",
          email: `${TEST_USER}@example.invalid`,
        })
        .onConflictDoNothing();

      const [plan] = await db
        .insert(schema.trainingPlans)
        .values({
          userId: TEST_USER,
          title: "Test Plan",
          raceType: "marathon",
          raceDate: "2026-12-01",
          startDate: "2026-01-01",
          weeksTotal: 16,
          currentWeek: 1,
          status: "active",
        })
        .returning();
      planId = plan.id;
    });

    afterAll(async () => {
      await db
        .delete(schema.weekPlans)
        .where(eq(schema.weekPlans.userId, TEST_USER));
      await db
        .delete(schema.activities)
        .where(eq(schema.activities.userId, TEST_USER));
      await db
        .delete(schema.trainingPlans)
        .where(eq(schema.trainingPlans.userId, TEST_USER));
      await db.delete(schema.users).where(eq(schema.users.id, TEST_USER));
    });

    beforeEach(async () => {
      await db
        .delete(schema.weekPlans)
        .where(eq(schema.weekPlans.userId, TEST_USER));
      await db
        .delete(schema.activities)
        .where(eq(schema.activities.userId, TEST_USER));
    });

    async function seedWeek(days: DaySlot[]): Promise<void> {
      await db.insert(schema.weekPlans).values({
        userId: TEST_USER,
        planId,
        weekStart: WEEK_START,
        skeletonWeek: 1,
        days,
        status: "open",
        effectiveTarget: 300,
      });
    }

    const YESTERDAY = DATES[0]; // Monday
    const TODAY = DATES[1]; // Tuesday
    const NOW = new Date(TODAY + "T12:00:00");

    it("books a synced activity on a rest day as unplannedLoad, without completing it or inventing a session", async () => {
      const days = DATES.map((d) => emptyDay(d));
      await seedWeek(days);

      const [activity] = await db
        .insert(schema.activities)
        .values({
          userId: TEST_USER,
          provider: "manual",
          externalId: `task10-rest-${Date.now()}`,
          sport: "Run",
          startDate: new Date(YESTERDAY + "T09:00:00"),
          load: 38,
        })
        .returning();

      expect(await runDailyAdaptation(TEST_USER, NOW)).toBe("adapted");

      const week = await getOpenWeekPlan(TEST_USER);
      const yesterdaySlot = week!.days.find((d) => d.date === YESTERDAY)!;
      expect(yesterdaySlot.unplannedLoad).toBe(38);
      expect(yesterdaySlot.actualLoad).toBeUndefined();
      expect(yesterdaySlot.status).toBe("rest");
      expect(yesterdaySlot.workouts).toHaveLength(0);
      expect(yesterdaySlot.activityId).toBe(activity.id);
    });

    /**
     * Final-review Finding 1: a rest/race day never sets yesterdayCompleted
     * (there is nothing planned to judge complete/missed), so nothing else
     * runDailyAdaptation does changes on a second run against the SAME
     * activity — the guard on `activityId` is what has to stop it. Without
     * it, a live run compounded unplannedLoad 100/200/300/400/500/600
     * across six identical hourly invocations and "adapted" never turned
     * into "skipped", so `week_plans` kept getting rewritten on every Apple
     * Health push — the exact write loop this hotfix exists to close.
     */
    it("does not re-book the same rest-day activity on a second run — unplannedLoad stays put and the run reports skipped", async () => {
      const days = DATES.map((d) => emptyDay(d));
      await seedWeek(days);

      await db.insert(schema.activities).values({
        userId: TEST_USER,
        provider: "manual",
        externalId: `task10-idempotent-${Date.now()}`,
        sport: "Run",
        startDate: new Date(YESTERDAY + "T09:00:00"),
        load: 100,
      });

      expect(await runDailyAdaptation(TEST_USER, NOW)).toBe("adapted");
      const afterFirst = await getOpenWeekPlan(TEST_USER);
      const slotAfterFirst = afterFirst!.days.find(
        (d) => d.date === YESTERDAY
      )!;
      expect(slotAfterFirst.unplannedLoad).toBe(100);

      // Five more runs, exactly as an hourly Apple Health push would drive.
      for (let i = 0; i < 5; i++) {
        expect(await runDailyAdaptation(TEST_USER, NOW)).toBe("skipped");
      }

      const afterMany = await getOpenWeekPlan(TEST_USER);
      const slotAfterMany = afterMany!.days.find((d) => d.date === YESTERDAY)!;
      expect(slotAfterMany.unplannedLoad).toBe(100);
    });

    it("still books a SECOND, different activity landing on the same rest day as additional unplanned load", async () => {
      const days = DATES.map((d) => emptyDay(d));
      await seedWeek(days);

      await db.insert(schema.activities).values({
        userId: TEST_USER,
        provider: "manual",
        externalId: `task10-first-${Date.now()}`,
        sport: "Run",
        startDate: new Date(YESTERDAY + "T09:00:00"),
        load: 40,
      });
      expect(await runDailyAdaptation(TEST_USER, NOW)).toBe("adapted");

      // A genuinely different activity on the same day — a second bonus
      // ride — must still add, not be swallowed by the same-activity guard.
      await db.insert(schema.activities).values({
        userId: TEST_USER,
        provider: "manual",
        externalId: `task10-second-${Date.now()}`,
        sport: "Run",
        startDate: new Date(YESTERDAY + "T10:00:00"),
        load: 20,
      });
      expect(await runDailyAdaptation(TEST_USER, NOW)).toBe("adapted");

      const week = await getOpenWeekPlan(TEST_USER);
      const yesterdaySlot = week!.days.find((d) => d.date === YESTERDAY)!;
      expect(yesterdaySlot.unplannedLoad).toBe(60);
    });

    it("books BOTH rides when the day's activities are already synced before the first run", async () => {
      // The test above interleaves insert → run → insert → run, which is not
      // how a real day arrives: runDailyAdaptation books onto YESTERDAY, so
      // by the time it runs, every ride of that day is already in the table.
      // `findFirst` then returns only the latest and the earlier ride's load
      // is dropped for good. Live evidence 2026-07-30: two rides, loads 63
      // and 67, of which only 67 would ever have been counted.
      const days = DATES.map((d) => emptyDay(d));
      await seedWeek(days);

      await db.insert(schema.activities).values([
        {
          userId: TEST_USER,
          provider: "manual",
          externalId: `both-morning-${Date.now()}`,
          sport: "Ride",
          startDate: new Date(YESTERDAY + "T07:48:00"),
          load: 63,
        },
        {
          userId: TEST_USER,
          provider: "manual",
          externalId: `both-afternoon-${Date.now()}`,
          sport: "Ride",
          startDate: new Date(YESTERDAY + "T13:48:00"),
          load: 67,
        },
      ]);

      expect(await runDailyAdaptation(TEST_USER, NOW)).toBe("adapted");

      const week = await getOpenWeekPlan(TEST_USER);
      const yesterdaySlot = week!.days.find((d) => d.date === YESTERDAY)!;
      expect(yesterdaySlot.unplannedLoad).toBe(130);
      expect(yesterdaySlot.status).toBe("rest");
    });

    it("never books a strava activity as unplanned load", async () => {
      // Every ride exists twice — once from intervals.icu, once from Strava —
      // with an IDENTICAL start_date and no tie-break, so which row this
      // matcher picked came down to heap order, and their loads diverge badly
      // (live: 67 vs 95, 184 vs 83). Asserting on the twin case would only
      // re-test that arbitrary ordering, so this seeds a strava-only day: the
      // firewall is that `provider='strava'` is never a source here at all.
      // The week plan is read by the coach through get_week_plan.
      const days = DATES.map((d) => emptyDay(d));
      await seedWeek(days);

      await db.insert(schema.activities).values({
        userId: TEST_USER,
        provider: "strava",
        externalId: `unplanned-strava-${Date.now()}`,
        sport: "Ride",
        startDate: new Date(YESTERDAY + "T09:00:00"),
        load: 95,
      });

      await runDailyAdaptation(TEST_USER, NOW);

      const week = await getOpenWeekPlan(TEST_USER);
      const yesterdaySlot = week!.days.find((d) => d.date === YESTERDAY)!;
      expect(yesterdaySlot.unplannedLoad).toBeUndefined();
      expect(yesterdaySlot.activityId).toBeUndefined();
    });

    it("ignores the strava twin on a PLANNED day too, booking the real load as actualLoad", async () => {
      // The planned-day matcher has the same omission as the rest-day one:
      // it filters by canonical sport but not by provider, so the strava
      // twin could win the tie and book its own divergent load as the
      // session's actualLoad — which is what week adherence and the next
      // week's ramp clamp are computed from.
      const days = DATES.map((d) => emptyDay(d));
      days[0] = {
        ...emptyDay(YESTERDAY),
        status: "planned",
        workouts: [sw({ sport: "Bike", durationMins: 60 })],
      };
      await seedWeek(days);

      await db.insert(schema.activities).values({
        userId: TEST_USER,
        provider: "strava",
        externalId: `planned-strava-${Date.now()}`,
        sport: "Ride",
        startDate: new Date(YESTERDAY + "T09:00:00"),
        load: 83,
      });

      await runDailyAdaptation(TEST_USER, NOW);

      const week = await getOpenWeekPlan(TEST_USER);
      const yesterdaySlot = week!.days.find((d) => d.date === YESTERDAY)!;
      expect(yesterdaySlot.actualLoad).toBeUndefined();
    });

    it("leaves every other day byte-identical when a rest-day activity is booked as unplanned load", async () => {
      const days = DATES.map((d) => emptyDay(d));
      // A real planned session elsewhere in the week — the invariant this
      // protects only means something if there's a session it could have
      // touched but didn't.
      days[3] = {
        ...emptyDay(DATES[3]),
        status: "planned",
        workouts: [sw({ sport: "Bike", durationMins: 60 })],
      };
      await seedWeek(days);

      await db.insert(schema.activities).values({
        userId: TEST_USER,
        provider: "manual",
        externalId: `task10-invariant-${Date.now()}`,
        sport: "Run",
        startDate: new Date(YESTERDAY + "T09:00:00"),
        load: 25,
      });

      const before = await getOpenWeekPlan(TEST_USER);
      expect(await runDailyAdaptation(TEST_USER, NOW)).toBe("adapted");
      const after = await getOpenWeekPlan(TEST_USER);

      for (let i = 0; i < 7; i++) {
        if (DATES[i] === YESTERDAY) continue;
        expect(after!.days[i]).toEqual(before!.days[i]);
      }
    });

    it("books a synced activity on a race day as unplanned load, keeping status race and raceName intact", async () => {
      const days = DATES.map((d) => emptyDay(d));
      days[0] = {
        ...emptyDay(YESTERDAY),
        status: "race",
        raceName: "Tune-up 10k",
      };
      await seedWeek(days);

      const [activity] = await db
        .insert(schema.activities)
        .values({
          userId: TEST_USER,
          provider: "manual",
          externalId: `task10-race-${Date.now()}`,
          sport: "Run",
          startDate: new Date(YESTERDAY + "T09:00:00"),
          load: 95,
        })
        .returning();

      expect(await runDailyAdaptation(TEST_USER, NOW)).toBe("adapted");

      const week = await getOpenWeekPlan(TEST_USER);
      const raceSlot = week!.days.find((d) => d.date === YESTERDAY)!;
      expect(raceSlot.status).toBe("race");
      expect(raceSlot.raceName).toBe("Tune-up 10k");
      expect(raceSlot.workouts).toHaveLength(0);
      expect(raceSlot.unplannedLoad).toBe(95);
      expect(raceSlot.activityId).toBe(activity.id);
    });
  }
);

/**
 * Task 3: an unchanged availability resolution must not trigger a replan.
 * The evidence: availability_change/redistributed logged three times
 * running on 2026-07-27, each time "19.2h→19.2h" — resolveWeek was re-run
 * and re-applied even though nothing about the athlete's schedule had
 * actually changed.
 */
describe.skipIf(!hasDb)(
  "applyResolvedAvailability — no-op on an unchanged resolution (Task 3)",
  () => {
    let planId: string;

    beforeAll(async () => {
      await db
        .insert(schema.users)
        .values({
          id: TEST_USER,
          name: "Test Week Plan Service User",
          email: `${TEST_USER}@example.invalid`,
        })
        .onConflictDoNothing();

      const [plan] = await db
        .insert(schema.trainingPlans)
        .values({
          userId: TEST_USER,
          title: "Test Plan",
          raceType: "marathon",
          raceDate: "2026-12-01",
          startDate: "2026-01-01",
          weeksTotal: 16,
          currentWeek: 1,
          status: "active",
        })
        .returning();
      planId = plan.id;
    });

    afterAll(async () => {
      await db
        .delete(schema.weekPlans)
        .where(eq(schema.weekPlans.userId, TEST_USER));
      await db
        .delete(schema.availabilityOverrides)
        .where(eq(schema.availabilityOverrides.userId, TEST_USER));
      await db
        .delete(schema.availabilityDefaults)
        .where(eq(schema.availabilityDefaults.userId, TEST_USER));
      await db
        .delete(schema.trainingPlans)
        .where(eq(schema.trainingPlans.userId, TEST_USER));
      await db.delete(schema.users).where(eq(schema.users.id, TEST_USER));
    });

    beforeEach(async () => {
      await db
        .delete(schema.weekPlans)
        .where(eq(schema.weekPlans.userId, TEST_USER));
      await db
        .delete(schema.availabilityOverrides)
        .where(eq(schema.availabilityOverrides.userId, TEST_USER));
      await db
        .delete(schema.availabilityDefaults)
        .where(eq(schema.availabilityDefaults.userId, TEST_USER));
      // A standard week: 60min, full energy, every day — same shape
      // resolveWeek will keep handing back across repeat calls, so a
      // second applyResolvedAvailability has nothing new to apply.
      await db.insert(schema.availabilityDefaults).values(
        Array.from({ length: 7 }, (_, weekday) => ({
          userId: TEST_USER,
          weekday,
          blocks: [blk(60)],
        }))
      );
    });

    // Seeded strictly smaller than the defaults (30min vs 60min) so the
    // first applyResolvedAvailability call is a genuine replan, not itself
    // a no-op — the no-op under test is specifically the SECOND call.
    async function seedWeek(): Promise<void> {
      const days = DATES.map((d) => emptyDay(d, [blk(30)]));
      await db.insert(schema.weekPlans).values({
        userId: TEST_USER,
        planId,
        weekStart: WEEK_START,
        skeletonWeek: 1,
        days,
        status: "open",
        effectiveTarget: 300,
      });
    }

    it("does not replan or log when resolved availability is unchanged", async () => {
      await seedWeek();

      const first = await applyResolvedAvailability(TEST_USER);
      expect(first).toBe("applied");

      const week = await getOpenWeekPlan(TEST_USER);
      const before = await db.query.planAdjustments.findMany({
        where: eq(schema.planAdjustments.weekPlanId, week!.id),
      });

      const second = await applyResolvedAvailability(TEST_USER);
      expect(second).toBe("skipped");

      const after = await db.query.planAdjustments.findMany({
        where: eq(schema.planAdjustments.weekPlanId, week!.id),
      });
      expect(after).toHaveLength(before.length);

      // The week itself is untouched too, not just the adjustment log.
      const weekAfter = await getOpenWeekPlan(TEST_USER);
      expect(weekAfter!.days).toEqual(week!.days);
    });

    it("still replans when the resolved blocks change shape at the same total hours", async () => {
      await seedWeek();

      expect(await applyResolvedAvailability(TEST_USER)).toBe("applied");

      // Monday's default goes from one 60min block to two 30min blocks —
      // same total (60min), genuinely different shape (two opportunities
      // instead of one). Comparing only the hour total would wrongly skip
      // this.
      await db
        .update(schema.availabilityDefaults)
        .set({ blocks: [blk(30), blk(30)] })
        .where(
          and(
            eq(schema.availabilityDefaults.userId, TEST_USER),
            eq(schema.availabilityDefaults.weekday, 0) // Monday = DATES[0]
          )
        );

      expect(await applyResolvedAvailability(TEST_USER)).toBe("applied");

      const week = await getOpenWeekPlan(TEST_USER);
      expect(week!.days[0].availableBlocks).toHaveLength(2);
    });
  }
);

/**
 * Task 5, Step 7: proves `periodize()`'s `firstRace` argument is actually
 * wired into the live rollover, not just accepted by the pure engine.
 * `materializeWeek`'s `previousARace` guard already has direct-call
 * coverage (materialize.test.ts, Task 3) — what was missing is proof that
 * `rolloverWeekPlan` itself populates either argument from the plan row it
 * already loaded. Two plans, identical in every input except whether
 * `firstRaceId` is set: if a future edit drops the `firstRace` argument at
 * either live `periodize()` call site (service.ts or project.ts), this
 * reverts to a single-arc skeleton and the two plans' `effectiveTarget`
 * converge for the same week number instead of diverging.
 */
describe.skipIf(!hasDb)(
  "rolloverWeekPlan wires firstRace into the live periodize() call (Task 5)",
  () => {
    const CONTROL_USER = "test-week-plan-service-firstrace-control";
    const TWO_RACE_USER = "test-week-plan-service-firstrace-tworace";
    const PLAN_START = "2026-01-05"; // Monday
    const RACE_ONE_DATE = addDaysYmd(PLAN_START, 30); // -> firstRaceWeek 5
    const FINAL_RACE_DATE = addDaysYmd(PLAN_START, 140);
    // Race one falls in week 5; marathon recovery is 2 weeks (Task 2's
    // raceRecoveryDays), so weeks 6-7 are the bridging recovery segment.
    // The single-arc control plan is still ramping its base phase at week 7
    // of 20 (baseWeeks = round(20 * 0.4) = 8).
    const IN_BRIDGE_WEEK = 7;

    async function seedPlan(
      userId: string,
      firstRace: { date: string; raceType: string } | null
    ): Promise<void> {
      await db
        .insert(schema.users)
        .values({
          id: userId,
          name: "Test Two-Race User",
          email: `${userId}@example.invalid`,
        })
        .onConflictDoNothing();

      let firstRaceId: string | null = null;
      if (firstRace) {
        const [race] = await db
          .insert(schema.races)
          .values({
            userId,
            name: "Race one",
            raceType: firstRace.raceType,
            sport: "Run",
            date: firstRace.date,
            priority: "A",
          })
          .returning();
        firstRaceId = race.id;
      }

      const [plan] = await db
        .insert(schema.trainingPlans)
        .values({
          userId,
          title: "Two-race wiring test plan",
          raceType: "marathon",
          raceDate: FINAL_RACE_DATE,
          startDate: PLAN_START,
          weeksTotal: 20,
          currentWeek: IN_BRIDGE_WEEK,
          startingCtl: 45,
          status: "active",
          constraints: { daysPerWeek: 5, hoursPerWeek: 8, sports: ["Run"] },
          firstRaceId,
          firstRaceDate: firstRace?.date ?? null,
          firstRaceType: firstRace?.raceType ?? null,
        })
        .returning();

      await db.insert(schema.trainingBlocks).values({
        planId: plan.id,
        weekNumber: IN_BRIDGE_WEEK,
        phase: "build",
        targetLoadTotal: 400,
        targetSessions: 5,
        workouts: [],
      });

      // A standard week so materializeWeek has real capacity to work with
      // — without it, an unconfigured user gets an all-rest week (see
      // resolveWeek) and the two skeletons' different targetLoadTotal would
      // both be masked by zero availability.
      await db.insert(schema.availabilityDefaults).values(
        Array.from({ length: 7 }, (_, weekday) => ({
          userId,
          weekday,
          blocks: [
            {
              start: null,
              end: null,
              mins: 90,
              energy: "normal" as const,
              sports: null,
            },
          ],
        }))
      );
    }

    async function readEffectiveTarget(userId: string): Promise<number | null> {
      const week = await db.query.weekPlans.findFirst({
        where: and(
          eq(schema.weekPlans.userId, userId),
          eq(schema.weekPlans.weekStart, mondayOf(new Date()))
        ),
      });
      return week?.effectiveTarget ?? null;
    }

    afterAll(async () => {
      for (const userId of [CONTROL_USER, TWO_RACE_USER]) {
        await db
          .delete(schema.weekPlans)
          .where(eq(schema.weekPlans.userId, userId));
        await db
          .delete(schema.trainingPlans)
          .where(eq(schema.trainingPlans.userId, userId));
        await db
          .delete(schema.availabilityDefaults)
          .where(eq(schema.availabilityDefaults.userId, userId));
        await db.delete(schema.races).where(eq(schema.races.userId, userId));
        await db.delete(schema.users).where(eq(schema.users.id, userId));
      }
    });

    it("rebuilds a two-race plan as two arcs, not one", async () => {
      // The regression this step exists to prevent: a rollover that
      // recomputes the skeleton WITHOUT firstRace produces a single arc, so
      // the plan the athlete confirmed silently stops matching the plan
      // they get.
      await seedPlan(CONTROL_USER, null);
      await seedPlan(TWO_RACE_USER, {
        date: RACE_ONE_DATE,
        raceType: "marathon",
      });

      expect(await rolloverWeekPlan(CONTROL_USER)).toBe("rolled");
      expect(await rolloverWeekPlan(TWO_RACE_USER)).toBe("rolled");

      const control = await readEffectiveTarget(CONTROL_USER);
      const twoRace = await readEffectiveTarget(TWO_RACE_USER);
      expect(control).not.toBeNull();
      expect(twoRace).not.toBeNull();

      // Same week number, same athlete profile, different skeleton: the
      // two-race plan is in recovery here and the single-race plan is
      // still building.
      expect(twoRace!).toBeLessThan(control!);
    });
  }
);
