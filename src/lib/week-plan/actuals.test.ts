import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { deriveDayActuals } from "./actuals";

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
