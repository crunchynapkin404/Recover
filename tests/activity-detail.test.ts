import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";
process.env.ENCRYPTION_KEY ??=
  "0000000000000000000000000000000000000000000000000000000000000000";

const fetchStreams = vi.fn();
const fetchIntervals = vi.fn();
vi.mock("@/lib/connectors/intervals", async (importOriginal) => {
  const real =
    await importOriginal<typeof import("@/lib/connectors/intervals")>();
  return {
    ...real,
    fetchActivityStreams: (...a: unknown[]) => fetchStreams(...a),
    fetchActivityIntervals: (...a: unknown[]) => fetchIntervals(...a),
  };
});

const OWNER = "test-detail-owner";
const OTHER = "test-detail-other";

describe.skipIf(!hasDb)("getOrFetchActivityDetail", () => {
  let icuActivityId: string;
  let manualActivityId: string;

  beforeAll(async () => {
    const { db, schema } = await import("@/lib/db");
    const { encrypt } = await import("@/lib/crypto");
    for (const id of [OWNER, OTHER]) {
      await db
        .insert(schema.users)
        .values({ id, name: id, email: `${id}@example.invalid` })
        .onConflictDoNothing();
    }
    await db
      .delete(schema.activities)
      .where(eq(schema.activities.userId, OWNER));
    await db
      .delete(schema.connections)
      .where(eq(schema.connections.userId, OWNER));
    await db.insert(schema.connections).values({
      userId: OWNER,
      provider: "intervals_icu",
      encryptedAccessToken: encrypt("icu-key"),
      externalAthleteId: "ath1",
      status: "active",
    });
    const [icu] = await db
      .insert(schema.activities)
      .values({
        userId: OWNER,
        provider: "intervals_icu",
        externalId: "icu-77",
        startDate: new Date(),
        sport: "Ride",
      })
      .returning();
    icuActivityId = icu.id;
    const [man] = await db
      .insert(schema.activities)
      .values({
        userId: OWNER,
        provider: "manual",
        externalId: "man-1",
        startDate: new Date(),
        sport: "Run",
      })
      .returning();
    manualActivityId = man.id;
  });

  afterAll(async () => {
    const { db, schema } = await import("@/lib/db");
    for (const id of [OWNER, OTHER])
      await db.delete(schema.users).where(eq(schema.users.id, id));
  });

  it("fetches, caches, and serves from cache on the second call", async () => {
    fetchStreams.mockResolvedValue([
      { type: "heartrate", data: [120, 125] },
      { type: "watts", data: [200, 210] },
    ]);
    fetchIntervals.mockResolvedValue([
      {
        index: 1,
        label: "L1",
        durationS: 60,
        distanceM: 500,
        avgHr: 150,
        avgPower: 220,
      },
    ]);
    const { getOrFetchActivityDetail } = await import("@/lib/activity-streams");

    const first = await getOrFetchActivityDetail(OWNER, icuActivityId);
    expect(first?.streams?.heartrate).toEqual([120, 125]);
    expect(first?.laps?.[0].label).toBe("L1");
    expect(fetchStreams).toHaveBeenCalledTimes(1);

    const second = await getOrFetchActivityDetail(OWNER, icuActivityId);
    expect(second?.streams?.watts).toEqual([200, 210]);
    expect(fetchStreams).toHaveBeenCalledTimes(1); // cache hit
  });

  it("returns unavailable for manual activities without calling the connector", async () => {
    fetchStreams.mockClear();
    const { getOrFetchActivityDetail } = await import("@/lib/activity-streams");
    const out = await getOrFetchActivityDetail(OWNER, manualActivityId);
    expect(out?.streams).toBeNull();
    expect(out?.reason).toBe("unavailable");
    expect(fetchStreams).not.toHaveBeenCalled();
  });

  it("hides other users' activities", async () => {
    const { getOrFetchActivityDetail } = await import("@/lib/activity-streams");
    expect(await getOrFetchActivityDetail(OTHER, icuActivityId)).toBeNull();
  });

  it("returns fetch_failed on connector errors, still renders summary", async () => {
    const { db, schema } = await import("@/lib/db");
    const [a2] = await db
      .insert(schema.activities)
      .values({
        userId: OWNER,
        provider: "intervals_icu",
        externalId: "icu-88",
        startDate: new Date(),
        sport: "Ride",
      })
      .returning();
    fetchStreams.mockRejectedValue(new Error("boom"));
    const { getOrFetchActivityDetail } = await import("@/lib/activity-streams");
    const out = await getOrFetchActivityDetail(OWNER, a2.id);
    expect(out?.streams).toBeNull();
    expect(out?.reason).toBe("fetch_failed");
  });
});
