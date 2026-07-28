import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import {
  getOpenWeekPlan,
  moveWorkout,
  recordUnplannedLoad,
  runDailyAdaptation,
  swapWorkouts,
} from "./service";
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

/**
 * Task 10: an activity's load always lands somewhere, but only a day WITH a
 * planned session may book it as `actualLoad` — a day with none (a rest day,
 * or a day whose session was already pulled elsewhere) must book it as
 * `unplannedLoad` instead, so it counts toward the week's totals without
 * ever reading as "this session's actual" and without ever triggering a
 * replan. Pure — no database involved, so this isn't gated on `hasDb`.
 */
describe("recordUnplannedLoad", () => {
  it("books load on a day with no planned session as unplanned", () => {
    const d = recordUnplannedLoad(emptyDay(DATES[0]), 55);
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
    const d = recordUnplannedLoad(planned, 55);
    expect(d.actualLoad).toBe(55);
    expect(d.unplannedLoad).toBeUndefined();
  });

  it("never removes a workout, even when the activity's load far exceeds what was planned", () => {
    const planned: DaySlot = {
      ...emptyDay(DATES[0]),
      status: "planned",
      workouts: [sw({ sport: "Bike", type: "Intervals", durationMins: 90 })],
    };
    const d = recordUnplannedLoad(planned, 400);
    expect(d.workouts).toHaveLength(1);
    expect(d.workouts[0].durationMins).toBe(90);
    expect(d.actualLoad).toBe(400);
  });

  it("accumulates repeated unplanned bookings on the same day rather than overwriting", () => {
    const once = recordUnplannedLoad(emptyDay(DATES[0]), 30);
    const twice = recordUnplannedLoad(once, 20);
    expect(twice.unplannedLoad).toBe(50);
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
