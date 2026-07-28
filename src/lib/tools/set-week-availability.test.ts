import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { setWeekAvailabilityTool } from "./set-week-availability";
import type { AvailabilityBlock } from "@/lib/availability/types";

// requires Postgres; skips without DATABASE_URL.
const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

const USER = "test-set-week-availability-user";

/**
 * I11 — the coach's availability write was never pinned.
 *
 * submitAvailability calls syncDateOverrides before applyAvailability, so the
 * athlete's edit lands in availability_overrides and survives. This tool
 * called applyAvailability alone: the open week's jsonb changed, but nothing
 * was pinned, so resolveWeek never saw the change and it died at the next
 * rematerialization. Two writers of the same concept with different
 * persistence semantics is exactly the asymmetry the two-table design exists
 * to remove.
 */
describe.skipIf(!hasDb)("set_week_availability pins its dates (I11)", () => {
  const WEEK_START = "2026-09-07"; // a Monday
  const DATES = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(WEEK_START + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });

  const blk = (o: Partial<AvailabilityBlock> = {}): AvailabilityBlock => ({
    start: null,
    end: null,
    mins: 60,
    energy: "normal",
    sports: null,
    ...o,
  });

  let planId: string;

  beforeAll(async () => {
    const { db, schema } = await import("@/lib/db");
    await db
      .insert(schema.users)
      .values({
        id: USER,
        name: "Set Week Availability Test",
        email: `${USER}@example.test`,
      })
      .onConflictDoNothing();
    const [plan] = await db
      .insert(schema.trainingPlans)
      .values({
        userId: USER,
        title: "Coach Availability Test Plan",
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
    await db
      .delete(schema.availabilityOverrides)
      .where(eq(schema.availabilityOverrides.userId, USER));
    await db
      .delete(schema.availabilityDefaults)
      .where(eq(schema.availabilityDefaults.userId, USER));
    await db.delete(schema.users).where(eq(schema.users.id, USER));
  });

  beforeEach(async () => {
    const { db, schema } = await import("@/lib/db");
    await db.delete(schema.weekPlans).where(eq(schema.weekPlans.userId, USER));
    await db
      .delete(schema.availabilityOverrides)
      .where(eq(schema.availabilityOverrides.userId, USER));
    await db
      .delete(schema.availabilityDefaults)
      .where(eq(schema.availabilityDefaults.userId, USER));

    // A standard week of one hour every day, and an open week that matches it.
    await db.insert(schema.availabilityDefaults).values(
      Array.from({ length: 7 }, (_, weekday) => ({
        userId: USER,
        weekday,
        blocks: [blk()],
      }))
    );
    await db.insert(schema.weekPlans).values({
      userId: USER,
      planId,
      weekStart: WEEK_START,
      skeletonWeek: 1,
      days: DATES.map((date) => ({
        date,
        availableBlocks: [blk()],
        availableMins: 60,
        workouts: [],
        status: "rest" as const,
      })),
      status: "open",
      effectiveTarget: 300,
    });
  });

  async function run(blocks: AvailabilityBlock[][]) {
    const { db } = await import("@/lib/db");
    return setWeekAvailabilityTool.execute(
      { availableBlocks: blocks },
      { userId: USER, db }
    );
  }

  it("writes an override for a day the coach changes", async () => {
    const { db, schema } = await import("@/lib/db");
    const changed = [blk({ mins: 150 })];

    const result = await run(
      DATES.map((_, i) => (i === 2 ? changed : [blk()]))
    );
    expect((result as { applied: boolean }).applied).toBe(true);

    const override = await db.query.availabilityOverrides.findFirst({
      where: and(
        eq(schema.availabilityOverrides.userId, USER),
        eq(schema.availabilityOverrides.date, DATES[2])
      ),
    });
    expect(override?.blocks).toEqual(changed);
  });

  it("leaves days matching the standard week unpinned", async () => {
    const { db, schema } = await import("@/lib/db");

    await run(DATES.map((_, i) => (i === 2 ? [blk({ mins: 150 })] : [blk()])));

    const rows = await db.query.availabilityOverrides.findMany({
      where: eq(schema.availabilityOverrides.userId, USER),
    });
    expect(rows.map((r) => r.date)).toEqual([DATES[2]]);
  });

  it("rejects a block that admits no sport rather than storing it", async () => {
    const { db, schema } = await import("@/lib/db");

    const result = await run(
      DATES.map((_, i) => (i === 3 ? [blk({ sports: [] })] : [blk()]))
    );
    expect(result).toMatchObject({ applied: false });

    const rows = await db.query.availabilityOverrides.findMany({
      where: eq(schema.availabilityOverrides.userId, USER),
    });
    expect(rows).toEqual([]);
  });
});
