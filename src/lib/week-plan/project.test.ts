import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { AvailabilityBlock } from "@/lib/availability/types";
import { dayMins } from "./types";
import type { DaySlot } from "./types";

// requires Postgres; skips without DATABASE_URL — same guard as the rest of
// week-plan's DB-gated suites (service.test.ts, repair.test.ts).
const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

const TEST_USER = "test-project-week-user";
const WEEK_START = "2026-07-20"; // Monday — the currently open (stored) week
const NEXT_WEEK_START = "2026-07-27"; // the following Monday — no stored row
const SKELETON_WEEK = 2;
const NOW = new Date("2026-07-21T12:00:00Z"); // Tuesday of WEEK_START's week

function blk(mins: number): AvailabilityBlock {
  return { start: null, end: null, mins, energy: "full", sports: null };
}

function weekDatesFrom(start: string): string[] {
  const out: string[] = [];
  const d = new Date(start + "T00:00:00");
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
const DATES = weekDatesFrom(WEEK_START);
const NEXT_DATES = weekDatesFrom(NEXT_WEEK_START);

function emptyDay(date: string): DaySlot {
  const availableBlocks = [blk(90)];
  return {
    date,
    availableBlocks,
    availableMins: dayMins({ availableBlocks }),
    workouts: [],
    status: "rest",
  };
}

describe.skipIf(!hasDb)("projectWeek", () => {
  it("returns null for a user with no active plan", async () => {
    const { projectWeek } = await import("@/lib/week-plan/project");
    const r = await projectWeek(
      "no-such-user-at-all",
      "2027-03-01",
      new Date("2027-02-24T09:00:00")
    );
    expect(r).toBeNull();
  });

  describe("with a seeded plan and open week", () => {
    let planId: string;

    beforeAll(async () => {
      await db
        .insert(schema.users)
        .values({
          id: TEST_USER,
          name: "Test Project Week User",
          email: `${TEST_USER}@example.invalid`,
        })
        .onConflictDoNothing();

      const [plan] = await db
        .insert(schema.trainingPlans)
        .values({
          userId: TEST_USER,
          title: "Test Project Plan",
          raceType: "century",
          raceDate: "2026-09-13",
          startDate: "2026-07-13",
          weeksTotal: 9,
          currentWeek: SKELETON_WEEK,
          startingCtl: 50,
          status: "active",
          constraints: { daysPerWeek: 4, hoursPerWeek: 8, sports: ["Bike"] },
        })
        .returning();
      planId = plan.id;

      // A standard week, so resolveWeek has something real to offer for next
      // week's dates — there is no stored row for them to read instead.
      await db.insert(schema.availabilityDefaults).values(
        Array.from({ length: 7 }, (_, weekday) => ({
          userId: TEST_USER,
          weekday,
          blocks: [blk(90)],
        }))
      );
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
      await db
        .delete(schema.availabilityOverrides)
        .where(eq(schema.availabilityOverrides.userId, TEST_USER));
    });

    async function seedOpenWeek(): Promise<void> {
      await db.insert(schema.weekPlans).values({
        userId: TEST_USER,
        planId,
        weekStart: WEEK_START,
        skeletonWeek: SKELETON_WEEK,
        days: DATES.map(emptyDay),
        status: "open",
      });
    }

    it("marks a week with no stored row as provisional", async () => {
      const { projectWeek } = await import("@/lib/week-plan/project");
      await seedOpenWeek();

      const thisWeek = await projectWeek(TEST_USER, WEEK_START, NOW);
      const nextWeek = await projectWeek(TEST_USER, NEXT_WEEK_START, NOW);

      expect(thisWeek).not.toBeNull();
      expect(thisWeek!.provisional).toBe(false);
      expect(nextWeek).not.toBeNull();
      expect(nextWeek!.provisional).toBe(true);
    });

    it("creates no week_plans row", async () => {
      const { projectWeek } = await import("@/lib/week-plan/project");
      await seedOpenWeek();

      const before = await db.query.weekPlans.findMany({
        where: eq(schema.weekPlans.userId, TEST_USER),
      });

      await projectWeek(TEST_USER, NEXT_WEEK_START, NOW);

      const after = await db.query.weekPlans.findMany({
        where: eq(schema.weekPlans.userId, TEST_USER),
      });
      // This is the plan's hardest invariant: projecting a future week must
      // never write a week_plans row for it.
      expect(after).toHaveLength(before.length);
      expect(after.some((r) => r.weekStart === NEXT_WEEK_START)).toBe(false);
    });

    it("assumes this week closes to plan, whatever this week's actuals say", async () => {
      const { projectWeek } = await import("@/lib/week-plan/project");
      await seedOpenWeek();

      const first = await projectWeek(TEST_USER, NEXT_WEEK_START, NOW);
      expect(first).not.toBeNull();

      // Book real actualLoad onto THIS week's own stored days — simulating
      // the athlete having actually trained already this week.
      const week = await db.query.weekPlans.findFirst({
        where: and(
          eq(schema.weekPlans.userId, TEST_USER),
          eq(schema.weekPlans.weekStart, WEEK_START)
        ),
      });
      const days = week!.days as DaySlot[];
      const mutated = days.map((d, i) =>
        i === 0 ? { ...d, status: "completed" as const, actualLoad: 999 } : d
      );
      await db
        .update(schema.weekPlans)
        .set({ days: mutated })
        .where(eq(schema.weekPlans.id, week!.id));

      const second = await projectWeek(TEST_USER, NEXT_WEEK_START, NOW);
      expect(second).not.toBeNull();
      // Next week's projection must not have moved at all — proves prevWeek
      // is not derived from this week's actuals-so-far. Do not delete this
      // test as redundant: it exists to fail the moment someone later wires
      // this week's actuals into a projected week's prevWeek.
      expect(second!.days).toEqual(first!.days);
      expect(second!.target).toEqual(first!.target);
    });

    it("reflects a pinned availability override for a future date", async () => {
      const { projectWeek } = await import("@/lib/week-plan/project");
      await seedOpenWeek();

      const overrideDate = NEXT_DATES[2];
      await db.insert(schema.availabilityOverrides).values({
        userId: TEST_USER,
        date: overrideDate,
        blocks: [blk(45)],
      });

      const projected = await projectWeek(TEST_USER, NEXT_WEEK_START, NOW);
      expect(projected).not.toBeNull();

      const day = projected!.days.find((d) => d.date === overrideDate);
      expect(day).toBeDefined();
      expect(day!.availableMins).toBe(45);
      expect(projected!.pinned[overrideDate]).toBe(true);
      // Untouched dates aren't pinned.
      expect(projected!.pinned[NEXT_DATES[0]]).toBe(false);
    });
  });
});
