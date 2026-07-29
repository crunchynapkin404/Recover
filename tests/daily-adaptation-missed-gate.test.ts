import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import {
  getOpenWeekPlan,
  listAdjustments,
  runDailyAdaptation,
} from "@/lib/week-plan/service";
import type { AvailabilityBlock } from "@/lib/availability/types";
import type { DaySlot } from "@/lib/week-plan/types";
import { withPurpose } from "@/lib/training-plan";

/**
 * The athlete rode 1.94h on 2026-07-21 at 18:50. runDailyAdaptation ran at
 * 04:50 the next morning — before any activity sync — found nothing, and
 * dropped the session as missed. Three consecutive weeks then closed as
 * "fully missed", each restarting the next at 60% of skeleton.
 */
const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";
const USER = "test-missed-gate-user";

vi.mock("@/lib/session", () => ({
  requireUser: async () => ({ id: USER, name: "GateUser" }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const WEEK_START = "2026-07-20"; // Monday
const YESTERDAY = "2026-07-20"; // Monday — the planned/missed session
const TODAY = "2026-07-21"; // Tuesday — runDailyAdaptation's "now"
// Matches the live reproduction: the hourly Apple Health push at 04:50,
// long before any activity sync would have run.
const NOW = new Date(TODAY + "T04:50:00");

function blk(mins = 90): AvailabilityBlock {
  return { start: null, end: null, mins, energy: "full", sports: null };
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

function restDay(date: string): DaySlot {
  return {
    date,
    availableBlocks: [blk(60)],
    availableMins: 60,
    workouts: [],
    status: "rest",
  };
}

/** A week with a planned Endurance/Bike session on YESTERDAY, rest elsewhere. */
function seededDays(): DaySlot[] {
  return DATES.map((date) => {
    if (date === YESTERDAY) {
      return {
        date,
        availableBlocks: [blk(120)],
        availableMins: 120,
        workouts: [
          withPurpose({
            day: 0,
            sport: "Bike",
            type: "Endurance",
            durationMins: 90,
            intensity: "Z1-Z2",
            description: "Easy ride",
            blockIdx: 0,
          }),
        ],
        status: "planned",
      };
    }
    return restDay(date);
  });
}

describe.skipIf(!hasDb)("runDailyAdaptation missed gate", () => {
  let planId: string;

  beforeAll(async () => {
    await db
      .insert(schema.users)
      .values({
        id: USER,
        name: "GateUser",
        email: `${USER}@example.invalid`,
      })
      .onConflictDoNothing();

    const [plan] = await db
      .insert(schema.trainingPlans)
      .values({
        userId: USER,
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
    await db.delete(schema.weekPlans).where(eq(schema.weekPlans.userId, USER));
    await db
      .delete(schema.activities)
      .where(eq(schema.activities.userId, USER));
    await db
      .delete(schema.connections)
      .where(eq(schema.connections.userId, USER));
    await db
      .delete(schema.trainingPlans)
      .where(eq(schema.trainingPlans.userId, USER));
    await db.delete(schema.users).where(eq(schema.users.id, USER));
  });

  beforeEach(async () => {
    await db.delete(schema.weekPlans).where(eq(schema.weekPlans.userId, USER));
    await db
      .delete(schema.activities)
      .where(eq(schema.activities.userId, USER));
    await db
      .delete(schema.connections)
      .where(eq(schema.connections.userId, USER));
  });

  async function seedWeek(): Promise<void> {
    await db.insert(schema.weekPlans).values({
      userId: USER,
      planId,
      weekStart: WEEK_START,
      skeletonWeek: 1,
      days: seededDays(),
      status: "open",
      effectiveTarget: 300,
    });
  }

  it("does not mark yesterday missed when no activity sync has run since", async () => {
    await seedWeek();
    // connections.lastSyncAt set to BEFORE yesterday ended (yesterday is
    // 2026-07-20, which ends at 2026-07-21T00:00 local) — this connection
    // last synced hours before the ride even happened.
    await db.insert(schema.connections).values({
      userId: USER,
      provider: "intervals_icu",
      encryptedAccessToken: "x",
      externalAthleteId: "i1",
      status: "active",
      lastSyncAt: new Date("2026-07-20T08:00:00Z"),
    });

    expect(await runDailyAdaptation(USER, NOW)).toBe("skipped");

    const week = await getOpenWeekPlan(USER);
    const ySlot = week!.days.find((d) => d.date === YESTERDAY)!;
    // The session stays put — not written off as missed.
    expect(ySlot.status).toBe("planned");
    expect(ySlot.workouts).toHaveLength(1);

    const adjustments = await listAdjustments(week!.id);
    expect(adjustments.some((a) => a.trigger === "missed_workout")).toBe(false);
  });

  it("marks yesterday missed once an activity sync has run since", async () => {
    await seedWeek();
    // connections.lastSyncAt set to AFTER yesterday ended, still no
    // activity row for the athlete — the sync ran and genuinely found
    // nothing.
    await db.insert(schema.connections).values({
      userId: USER,
      provider: "intervals_icu",
      encryptedAccessToken: "x",
      externalAthleteId: "i1",
      status: "active",
      lastSyncAt: new Date("2026-07-21T03:00:00Z"),
    });

    expect(await runDailyAdaptation(USER, NOW)).toBe("adapted");

    const week = await getOpenWeekPlan(USER);
    const ySlot = week!.days.find((d) => d.date === YESTERDAY)!;
    expect(ySlot.status).toBe("missed");
    expect(ySlot.workouts).toHaveLength(0);

    const adjustments = await listAdjustments(week!.id);
    expect(adjustments.some((a) => a.trigger === "missed_workout")).toBe(true);
  });

  it("still judges a manual-only athlete with no activity connection", async () => {
    await seedWeek();
    // No rows in connections for an activity provider at all — nothing
    // will ever sync for this athlete, so their data is already as settled
    // as it will ever be.

    expect(await runDailyAdaptation(USER, NOW)).toBe("adapted");

    const week = await getOpenWeekPlan(USER);
    const ySlot = week!.days.find((d) => d.date === YESTERDAY)!;
    expect(ySlot.status).toBe("missed");
    expect(ySlot.workouts).toHaveLength(0);

    const adjustments = await listAdjustments(week!.id);
    expect(adjustments.some((a) => a.trigger === "missed_workout")).toBe(true);
  });

  /**
   * Final-review Finding 3: on auth_expired, intervals-sync.ts sets status
   * "error", and ensureJobsForConnections (scheduler.ts) only schedules
   * "active" connections — so lastSyncAt freezes for good and, without a
   * bound, missed-workout judgement would be silently disabled forever.
   * A dead connection must settle immediately, independent of how recent
   * (or stale) its last successful sync happened to be.
   */
  it("marks yesterday missed once the connection's status is no longer active, regardless of lastSyncAt", async () => {
    await seedWeek();
    // Same lastSyncAt as the "no sync since" case above — on its own this
    // would NOT be settled (it's before dayEnd). It's the status, not the
    // timestamp, that must settle it here.
    await db.insert(schema.connections).values({
      userId: USER,
      provider: "intervals_icu",
      encryptedAccessToken: "x",
      externalAthleteId: "i1",
      status: "error",
      lastSyncAt: new Date("2026-07-20T08:00:00Z"),
    });

    expect(await runDailyAdaptation(USER, NOW)).toBe("adapted");

    const week = await getOpenWeekPlan(USER);
    const ySlot = week!.days.find((d) => d.date === YESTERDAY)!;
    expect(ySlot.status).toBe("missed");
    expect(ySlot.workouts).toHaveLength(0);

    const adjustments = await listAdjustments(week!.id);
    expect(adjustments.some((a) => a.trigger === "missed_workout")).toBe(true);
  });

  /**
   * A connection can also stall without ever flipping out of "active" — any
   * failure OTHER than auth_expired leaves status "active" and can keep
   * failing indefinitely (intervals-sync.ts's catch block). The staleness
   * bound catches that case even though the status check does not.
   */
  it("marks yesterday missed once an active connection has gone stale beyond the bound", async () => {
    await seedWeek();
    const fourDaysAgo = new Date(NOW.getTime() - 4 * 24 * 60 * 60 * 1000);
    await db.insert(schema.connections).values({
      userId: USER,
      provider: "intervals_icu",
      encryptedAccessToken: "x",
      externalAthleteId: "i1",
      status: "active",
      lastSyncAt: fourDaysAgo,
    });

    expect(await runDailyAdaptation(USER, NOW)).toBe("adapted");

    const week = await getOpenWeekPlan(USER);
    const ySlot = week!.days.find((d) => d.date === YESTERDAY)!;
    expect(ySlot.status).toBe("missed");
    expect(ySlot.workouts).toHaveLength(0);

    const adjustments = await listAdjustments(week!.id);
    expect(adjustments.some((a) => a.trigger === "missed_workout")).toBe(true);
  });

  it("does NOT mark yesterday missed for an active connection that is merely a couple of days behind", async () => {
    await seedWeek();
    // Within the staleness bound and before dayEnd — an ordinary short sync
    // gap (a weekend, a slow provider) must still wait, not judge.
    const twoDaysAgo = new Date(NOW.getTime() - 2 * 24 * 60 * 60 * 1000);
    await db.insert(schema.connections).values({
      userId: USER,
      provider: "intervals_icu",
      encryptedAccessToken: "x",
      externalAthleteId: "i1",
      status: "active",
      lastSyncAt: twoDaysAgo,
    });

    expect(await runDailyAdaptation(USER, NOW)).toBe("skipped");

    const week = await getOpenWeekPlan(USER);
    const ySlot = week!.days.find((d) => d.date === YESTERDAY)!;
    expect(ySlot.status).toBe("planned");
    expect(ySlot.workouts).toHaveLength(1);

    const adjustments = await listAdjustments(week!.id);
    expect(adjustments.some((a) => a.trigger === "missed_workout")).toBe(false);
  });
});
