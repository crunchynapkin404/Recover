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

// Curves cache service tests (v0.4c). Requires Postgres.
const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

const USER = "test-athlete-curves-user";

const POWER = {
  secs: [60, 300, 1200],
  watts: [400, 330, 300],
  wattsPerKg: null,
};

async function cleanup() {
  const { db, schema } = await import("@/lib/db");
  await db
    .delete(schema.athleteCurves)
    .where(eq(schema.athleteCurves.userId, USER));
  await db
    .delete(schema.connections)
    .where(eq(schema.connections.userId, USER));
  await db.delete(schema.users).where(eq(schema.users.id, USER));
}

async function seedConnection() {
  const { db, schema } = await import("@/lib/db");
  const { encrypt } = await import("@/lib/crypto");
  await db.insert(schema.connections).values({
    userId: USER,
    provider: "intervals_icu",
    encryptedAccessToken: encrypt("test-api-key"),
    externalAthleteId: "i999",
    status: "active",
  });
}

describe.skipIf(!hasDb)("athlete curves cache", () => {
  beforeAll(async () => {
    await cleanup();
    const { db, schema } = await import("@/lib/db");
    await db
      .insert(schema.users)
      .values({ id: USER, name: "Curves", email: "curves@example.invalid" })
      .onConflictDoNothing();
  });

  beforeEach(async () => {
    const { db, schema } = await import("@/lib/db");
    await db
      .delete(schema.athleteCurves)
      .where(eq(schema.athleteCurves.userId, USER));
    await db
      .delete(schema.connections)
      .where(eq(schema.connections.userId, USER));
  });

  afterAll(cleanup);

  it("returns no_connection for a manual-only user", async () => {
    const { getCurves } = await import("@/lib/athlete-curves");
    expect(await getCurves(USER, "power")).toEqual({
      available: false,
      reason: "no_connection",
    });
  });

  it("cache miss fetches, stores, and returns fresh data", async () => {
    const { db, schema } = await import("@/lib/db");
    const { getCurves } = await import("@/lib/athlete-curves");
    await seedConnection();
    const power = vi.fn().mockResolvedValue(POWER);

    const result = await getCurves(USER, "power", { fetchers: { power } });
    expect(result).toMatchObject({
      available: true,
      stale: false,
      data: POWER,
    });
    expect(power).toHaveBeenCalledWith({
      apiKey: "test-api-key",
      athleteId: "i999",
      days: 90,
    });

    const rows = await db.query.athleteCurves.findMany({
      where: eq(schema.athleteCurves.userId, USER),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "power", params: "days=90" });
  });

  it("fresh cache short-circuits the connector", async () => {
    const { getCurves } = await import("@/lib/athlete-curves");
    await seedConnection();
    const power = vi.fn().mockResolvedValue(POWER);
    await getCurves(USER, "power", { fetchers: { power } });
    await getCurves(USER, "power", { fetchers: { power } });
    expect(power).toHaveBeenCalledTimes(1);
  });

  it("expired TTL refetches", async () => {
    const { getCurves, CURVES_TTL_MS } = await import("@/lib/athlete-curves");
    await seedConnection();
    const power = vi.fn().mockResolvedValue(POWER);
    const t0 = new Date("2026-07-15T06:00:00Z");
    await getCurves(USER, "power", { fetchers: { power }, now: t0 });
    const later = new Date(t0.getTime() + CURVES_TTL_MS + 60_000);
    await getCurves(USER, "power", { fetchers: { power }, now: later });
    expect(power).toHaveBeenCalledTimes(2);
  });

  it("serves stale cache on fetch failure, unavailable without cache", async () => {
    const { getCurves, CURVES_TTL_MS } = await import("@/lib/athlete-curves");
    await seedConnection();
    const failing = vi.fn().mockRejectedValue(new Error("icu down"));

    // no cache at all → unavailable
    expect(
      await getCurves(USER, "power", { fetchers: { power: failing } })
    ).toEqual({ available: false, reason: "fetch_failed" });

    // seed a cache entry, expire it, fail the refetch → stale copy
    const ok = vi.fn().mockResolvedValue(POWER);
    const t0 = new Date("2026-07-15T06:00:00Z");
    await getCurves(USER, "power", { fetchers: { power: ok }, now: t0 });
    const later = new Date(t0.getTime() + CURVES_TTL_MS + 60_000);
    const result = await getCurves(USER, "power", {
      fetchers: { power: failing },
      now: later,
    });
    expect(result).toMatchObject({ available: true, stale: true, data: POWER });
  });

  it("caches best efforts under kind=best_efforts and separate params", async () => {
    const { db, schema } = await import("@/lib/db");
    const { getBestEffortsCached } = await import("@/lib/athlete-curves");
    await seedConnection();
    const bestEfforts = vi.fn().mockResolvedValue([
      {
        label: "5k",
        sport: "Run",
        value: 1260,
        unit: "s",
        activityExternalId: "i1",
        date: "2026-07-01",
      },
    ]);
    await getBestEffortsCached(USER, { fetchers: { bestEfforts }, days: 30 });
    const rows = await db.query.athleteCurves.findMany({
      where: eq(schema.athleteCurves.userId, USER),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "best_efforts", params: "days=30" });
  });
});
