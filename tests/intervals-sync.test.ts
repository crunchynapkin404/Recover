import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";

const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

const USER = "test-intervals-sync-user";

describe.skipIf(!hasDb)("upsertIntervalsActivities", () => {
  afterAll(async () => {
    const { db, schema } = await import("@/lib/db");
    await db
      .delete(schema.activities)
      .where(eq(schema.activities.userId, USER));
    await db.delete(schema.users).where(eq(schema.users.id, USER));
  });

  beforeEach(async () => {
    const { db, schema } = await import("@/lib/db");
    await db
      .insert(schema.users)
      .values({
        id: USER,
        name: "Sync Test",
        email: "sync-test@example.invalid",
      })
      .onConflictDoNothing();
    await db
      .delete(schema.activities)
      .where(eq(schema.activities.userId, USER));
  });

  it("stores startDateLocal alongside startDate for a normal activity", async () => {
    const { db, schema } = await import("@/lib/db");
    const { upsertIntervalsActivities } =
      await import("@/lib/sync/intervals-sync");
    await upsertIntervalsActivities(USER, [
      {
        externalId: "is-1",
        startDate: new Date("2026-01-10T06:00:00Z"),
        startDateLocal: new Date("2026-01-10T08:00:00"),
        sport: "Ride",
        name: "Test ride",
        durationS: 3600,
        distanceM: 30000,
        load: 60,
        avgHr: 140,
        avgPower: 180,
        elevationM: 100,
        raw: { id: "is-1", source: "GARMIN_CONNECT" },
      },
    ]);
    const row = await db.query.activities.findFirst({
      where: and(
        eq(schema.activities.userId, USER),
        eq(schema.activities.externalId, "is-1")
      ),
    });
    expect(row?.startDate.getTime()).toBe(
      new Date("2026-01-10T06:00:00Z").getTime()
    );
    expect(row?.startDateLocal?.getTime()).toBe(
      new Date("2026-01-10T08:00:00").getTime()
    );
  });

  it("corrects startDate for a Strava-sourced stub row using the sibling strava-provider row", async () => {
    const { db, schema } = await import("@/lib/db");
    const { upsertIntervalsActivities } =
      await import("@/lib/sync/intervals-sync");
    // The native Strava sync already landed its own, correctly-UTC row.
    await db.insert(schema.activities).values({
      userId: USER,
      provider: "strava",
      externalId: "19435415759",
      startDate: new Date("2026-07-23T17:57:38Z"),
      sport: "Ride",
    });

    // intervals.icu's withheld payload only ever carries start_date_local.
    await upsertIntervalsActivities(USER, [
      {
        externalId: "19435415759",
        startDate: new Date("2026-07-23T19:57:38"), // mis-scaled last resort
        startDateLocal: new Date("2026-07-23T19:57:38"),
        sport: "Ride",
        name: null,
        durationS: null,
        distanceM: null,
        load: null,
        avgHr: null,
        avgPower: null,
        elevationM: null,
        raw: {
          id: "19435415759",
          source: "STRAVA",
          _note: "STRAVA activities are not available via the API",
        },
      },
    ]);

    const row = await db.query.activities.findFirst({
      where: and(
        eq(schema.activities.userId, USER),
        eq(schema.activities.provider, "intervals_icu"),
        eq(schema.activities.externalId, "19435415759")
      ),
    });
    // Corrected from the sibling strava row's true UTC value, not the
    // mis-scaled 19:57:38 the intervals.icu stub itself carried.
    expect(row?.startDate.getTime()).toBe(
      new Date("2026-07-23T17:57:38Z").getTime()
    );
  });
});
