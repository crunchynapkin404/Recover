import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import {
  bookDayLoad,
  bookWeekActuals,
  deriveDayActuals,
  weekActuals,
} from "./actuals";
import type { DaySlot, ScheduledWorkout } from "./types";
import { withPurpose } from "@/lib/training-plan";

// requires Postgres; skips without DATABASE_URL.
const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

const TEST_USER = "test-week-actuals-user";

async function addActivity(o: {
  externalId: string;
  provider?: "intervals_icu" | "strava" | "manual";
  sport?: string;
  startLocal?: string | null;
  start: string;
  durationS?: number | null;
  load?: number | null;
}) {
  await db.insert(schema.activities).values({
    userId: TEST_USER,
    provider: o.provider ?? "intervals_icu",
    externalId: o.externalId,
    startDate: new Date(o.start),
    startDateLocal:
      o.startLocal === null ? null : new Date(o.startLocal ?? o.start),
    sport: o.sport ?? "Ride",
    durationS: o.durationS ?? 3600,
    // `??` alone would turn an explicit `load: null` back into 100 (null is
    // nullish too) and silently defeat the null-load test below — same trap
    // startDateLocal above already guards against, mirrored here.
    load: o.load === null ? null : (o.load ?? 100),
  });
}

describe.skipIf(!hasDb)("deriveDayActuals", () => {
  beforeAll(async () => {
    await db
      .insert(schema.users)
      .values({
        id: TEST_USER,
        name: "Test Week Actuals User",
        email: `${TEST_USER}@example.invalid`,
      })
      .onConflictDoNothing();
    await db
      .delete(schema.activities)
      .where(eq(schema.activities.userId, TEST_USER));
  });

  afterAll(async () => {
    await db
      .delete(schema.activities)
      .where(eq(schema.activities.userId, TEST_USER));
    await db.delete(schema.users).where(eq(schema.users.id, TEST_USER));
  });

  it("sums every activity on a day, not just the most recent", async () => {
    await addActivity({
      externalId: "sum-a",
      start: "2026-07-30T08:00:00",
      load: 63,
    });
    await addActivity({
      externalId: "sum-b",
      start: "2026-07-30T17:00:00",
      load: 67,
    });

    const out = await deriveDayActuals(TEST_USER, "2026-07-30", "2026-07-30");

    expect(out["2026-07-30"].load).toBe(130);
    expect(out["2026-07-30"].count).toBe(2);
  });

  it("names the day's most recent activity", async () => {
    const out = await deriveDayActuals(TEST_USER, "2026-07-30", "2026-07-30");
    const row = await db.query.activities.findFirst({
      where: eq(schema.activities.externalId, "sum-b"),
    });
    expect(out["2026-07-30"].activityId).toBe(row!.id);
  });

  it("excludes strava rows", async () => {
    await addActivity({
      externalId: "strava-dupe",
      provider: "strava",
      start: "2026-07-30T08:00:00",
      load: 999,
    });

    const out = await deriveDayActuals(TEST_USER, "2026-07-30", "2026-07-30");

    expect(out["2026-07-30"].load).toBe(130);
  });

  it("treats a null load as zero rather than dropping the activity", async () => {
    await addActivity({
      externalId: "no-load",
      start: "2026-07-31T09:00:00",
      load: null,
      durationS: 1800,
    });

    const out = await deriveDayActuals(TEST_USER, "2026-07-31", "2026-07-31");

    expect(out["2026-07-31"].load).toBe(0);
    expect(out["2026-07-31"].count).toBe(1);
    expect(out["2026-07-31"].secs).toBe(1800);
  });

  it("falls back to startDate when startDateLocal is null", async () => {
    await addActivity({
      externalId: "pre-backfill",
      start: "2026-08-01T10:00:00",
      startLocal: null,
      load: 314,
    });

    const out = await deriveDayActuals(TEST_USER, "2026-08-01", "2026-08-01");

    expect(out["2026-08-01"].load).toBe(314);
  });

  it("includes both edges of the window and nothing outside it", async () => {
    await addActivity({
      externalId: "edge-before",
      start: "2026-07-29T23:59:00",
      load: 11,
    });
    await addActivity({
      externalId: "edge-after",
      start: "2026-08-02T00:00:00",
      load: 22,
    });

    const out = await deriveDayActuals(TEST_USER, "2026-07-30", "2026-08-01");

    expect(out["2026-07-29"]).toBeUndefined();
    expect(out["2026-08-02"]).toBeUndefined();
    expect(out["2026-07-30"].load).toBe(130);
    expect(out["2026-08-01"].load).toBe(314);
  });

  it("omits days with no activity rather than returning zeroes", async () => {
    const out = await deriveDayActuals(TEST_USER, "2026-07-30", "2026-08-01");
    expect(out["2026-07-30"]).toBeDefined();
    expect(Object.keys(out)).not.toContain("2026-07-29");
  });
});

function sw(o: Partial<ScheduledWorkout> = {}): ScheduledWorkout {
  return withPurpose({
    day: 0,
    sport: "Bike",
    type: "Endurance",
    durationMins: 60,
    intensity: "Z1-Z2",
    description: "Easy ride",
    blockIdx: 0,
    ...o,
  });
}

function day(date: string, o: Partial<DaySlot> = {}): DaySlot {
  return {
    date,
    availableBlocks: [
      { start: null, end: null, mins: 90, energy: "full", sports: null },
    ],
    availableMins: 90,
    workouts: [],
    status: "rest",
    ...o,
  };
}

function actual(load: number, id = "act-1") {
  return { count: 1, secs: 3600, load, activityId: id };
}

describe("bookWeekActuals", () => {
  it("books a day that has workouts as the session's actual", () => {
    const days = [day("2026-07-28", { status: "completed", workouts: [sw()] })];
    const out = bookWeekActuals(
      days,
      { "2026-07-28": actual(155) },
      "2026-07-28"
    );
    expect(out[0].actualLoad).toBe(155);
    expect(out[0].unplannedLoad).toBeUndefined();
    expect(out[0].activityId).toBe("act-1");
  });

  it("books a day with no workouts as unplanned", () => {
    const days = [day("2026-07-30")];
    const out = bookWeekActuals(
      days,
      { "2026-07-30": actual(130) },
      "2026-07-30"
    );
    expect(out[0].unplannedLoad).toBe(130);
    expect(out[0].actualLoad).toBeUndefined();
  });

  it("never leaves both fields set when a day's workouts go away", () => {
    // handleMissedYesterday empties a missed day's workouts, so the same day
    // can route to actualLoad on one pass and unplannedLoad on the next.
    // weekActuals SUMS the two fields, so a stale one double-counts.
    const days = [day("2026-07-28", { status: "missed", actualLoad: 136 })];
    const out = bookWeekActuals(
      days,
      { "2026-07-28": actual(136) },
      "2026-07-28"
    );
    expect(out[0].unplannedLoad).toBe(136);
    expect(out[0].actualLoad).toBeUndefined();
    expect(weekActuals(out).actualLoad).toBe(136);
  });

  it("clears the booking fields on a day whose activity is gone", () => {
    const days = [day("2026-07-28", { actualLoad: 155, activityId: "act-1" })];
    const out = bookWeekActuals(days, {}, "2026-07-28");
    expect(out[0].actualLoad).toBeUndefined();
    expect(out[0].unplannedLoad).toBeUndefined();
    expect(out[0].activityId).toBeUndefined();
  });

  it("leaves days after throughYmd untouched", () => {
    const days = [day("2026-08-06"), day("2026-08-07")];
    const out = bookWeekActuals(
      days,
      { "2026-08-06": actual(50), "2026-08-07": actual(90) },
      "2026-08-06"
    );
    expect(out[0].unplannedLoad).toBe(50);
    expect(out[1].unplannedLoad).toBeUndefined();
  });

  it("is a byte-identical no-op on a day that is already right", () => {
    // The repair script's safety and runDailyAdaptation's change detection
    // both rest on this: re-running must produce the same JSON, key order
    // included, or every pass rewrites week_plans.
    const days = [
      day("2026-07-27", {
        status: "completed",
        workouts: [sw()],
        actualLoad: 184,
        activityId: "act-9",
      }),
      day("2026-07-29"),
    ];
    const out = bookWeekActuals(
      days,
      { "2026-07-27": actual(184, "act-9") },
      "2026-07-29"
    );
    expect(JSON.stringify(out)).toBe(JSON.stringify(days));
  });

  it("reproduces the live week of 2026-07-27 at 783, not 314", () => {
    const days = [
      day("2026-07-27", { status: "completed", workouts: [sw()] }),
      day("2026-07-28", { status: "completed", workouts: [sw()] }),
      day("2026-07-29"),
      day("2026-07-30"),
      day("2026-07-31"),
      day("2026-08-01", { status: "completed", workouts: [sw()] }),
      day("2026-08-02"),
    ];
    const out = bookWeekActuals(
      days,
      {
        "2026-07-27": actual(184, "a1"),
        "2026-07-28": actual(155, "a2"),
        "2026-07-30": { count: 2, secs: 5760, load: 130, activityId: "a3" },
        "2026-08-01": actual(314, "a4"),
      },
      "2026-08-02"
    );
    expect(weekActuals(out).actualLoad).toBe(783);
  });
});
