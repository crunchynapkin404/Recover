/**
 * Surface tests for the three curve/best-effort MCP tools (v0.4c, phase 2c
 * condition 4). `athlete-curves.test.ts` covers the cache owner directly;
 * this file proves the tools shape what that owner returns correctly, by
 * exercising the REAL read path — a real connection row, a real fresh-cache
 * hit in `cachedFetch()`, and the tool's own formatting — with no network
 * and no mocked owner module.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { getPowerCurve } from "@/lib/tools/get-power-curve";
import { getPaceCurve } from "@/lib/tools/get-pace-curve";
import { getBestEfforts } from "@/lib/tools/get-best-efforts";

// requires Postgres; skips without DATABASE_URL.
const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

// One user per outcome that would otherwise fight over a single seed: the
// "available" users each need an active connection + a fresh cache row, the
// "no connection" user must have neither, and the three "available" users
// are kept separate so a corrupted-seed bug in one tool's row can't leak
// into another tool's assertions.
const USER_POWER = "test-curve-tools-power-user";
const USER_PACE = "test-curve-tools-pace-user";
const USER_BEST_EFFORTS = "test-curve-tools-best-efforts-user";
const USER_NO_CONNECTION = "test-curve-tools-no-connection-user";

const USER_STALE = "test-curve-tools-stale-user";

const ALL_USERS = [
  USER_POWER,
  USER_PACE,
  USER_BEST_EFFORTS,
  USER_NO_CONNECTION,
  USER_STALE,
];
const CONNECTED_USERS = [USER_POWER, USER_PACE, USER_BEST_EFFORTS, USER_STALE];

// Recent enough to sit inside CURVES_TTL_MS (6h), so cachedFetch() returns
// this row as a fresh hit before it ever reaches the (network-blocked)
// fetcher.
const FETCHED_AT = new Date(Date.now() - 60 * 60 * 1000);

// Deliberately OUTSIDE the 6h TTL, so cachedFetch() considers this row
// expired and calls the real fetcher — which tests/setup/no-network.ts
// rejects. That rejection is not an accident of the test environment; it is
// a faithful stand-in for the production condition this path exists to
// handle (intervals.icu unreachable, a dead token, a 500). cachedFetch()
// catches it and serves the expired row with `stale: true`.
const STALE_FETCHED_AT = new Date(Date.now() - 12 * 60 * 60 * 1000);

// Values chosen so rounding actually changes the number (v0.89.0 lesson: a
// fixture whose values coincide with their rounded form can hide a dropped
// Math.round). Verified with node: Math.round -> [900, 551, 331, 281, 251].
const POWER_DATA = {
  secs: [5, 60, 300, 1200, 3600],
  watts: [900.4, 550.6, 330.6, 280.6, 250.9],
  wattsPerKg: null,
};

// Verified with node: toFixed(1) -> [200.3, 211.3, 220.6, 233.2, 240.8].
const PACE_DATA = {
  distanceM: [400, 1000, 5000, 10000, 21097],
  secsPerKm: [200.34, 211.27, 220.56, 233.19, 240.83],
};

// Two sports, unfiltered count (3) distinct from either filtered count (2
// Ride, 1 Run) — needed so a "count = result.data.length" mutation shows up
// on the filtered assertion.
const BEST_EFFORTS_DATA = [
  {
    label: "5s power",
    sport: "Ride",
    value: 900,
    unit: "w",
    activityExternalId: "curve-tools-act-1",
    date: "2026-08-01",
  },
  {
    label: "1min power",
    sport: "Ride",
    value: 550,
    unit: "w",
    activityExternalId: "curve-tools-act-2",
    date: "2026-08-02",
  },
  {
    label: "5k",
    sport: "Run",
    value: 1100,
    unit: "s",
    activityExternalId: "curve-tools-act-3",
    date: "2026-08-03",
  },
];

async function cleanup() {
  await db
    .delete(schema.athleteCurves)
    .where(inArray(schema.athleteCurves.userId, ALL_USERS));
  await db
    .delete(schema.connections)
    .where(inArray(schema.connections.userId, ALL_USERS));
  await db.delete(schema.users).where(inArray(schema.users.id, ALL_USERS));
}

async function seedConnection(userId: string, externalAthleteId: string) {
  await db.insert(schema.connections).values({
    userId,
    provider: "intervals_icu",
    encryptedAccessToken: encrypt("test-api-key"),
    externalAthleteId,
    status: "active",
  });
}

describe.skipIf(!hasDb)("curve tools surface", () => {
  beforeAll(async () => {
    await cleanup();

    for (const id of ALL_USERS) {
      await db
        .insert(schema.users)
        .values({ id, name: id, email: `${id}@example.invalid` })
        .onConflictDoNothing();
    }

    for (const id of CONNECTED_USERS) {
      await seedConnection(id, `i-${id}`);
    }

    await db.insert(schema.athleteCurves).values([
      {
        userId: USER_POWER,
        kind: "power",
        params: "days=30",
        data: POWER_DATA,
        fetchedAt: FETCHED_AT,
      },
      {
        userId: USER_PACE,
        kind: "pace",
        params: "days=30",
        data: PACE_DATA,
        fetchedAt: FETCHED_AT,
      },
      {
        userId: USER_BEST_EFFORTS,
        kind: "best_efforts",
        params: "days=30",
        data: BEST_EFFORTS_DATA,
        fetchedAt: FETCHED_AT,
      },
      {
        userId: USER_STALE,
        kind: "power",
        params: "days=30",
        data: POWER_DATA,
        fetchedAt: STALE_FETCHED_AT,
      },
    ]);
  });

  afterAll(cleanup);

  describe("get_power_curve", () => {
    it("returns the available curve with rounded key points and echoed days", async () => {
      const result = (await getPowerCurve.execute(
        { days: 30 },
        { userId: USER_POWER, db }
      )) as {
        available: boolean;
        stale: boolean;
        fetched_at: string;
        days: number;
        key_points: { duration_s: number; watts: number }[];
      };

      expect(result.available).toBe(true);
      expect(result.stale).toBe(false);
      expect(result.fetched_at).toBe(FETCHED_AT.toISOString());
      expect(result.days).toBe(30);
      expect(result.key_points).toEqual([
        { duration_s: 5, watts: 900 },
        { duration_s: 60, watts: 551 },
        { duration_s: 300, watts: 331 },
        { duration_s: 1200, watts: 281 },
        { duration_s: 3600, watts: 251 },
      ]);
    });

    it("tells the coach why there is no figure for a user with no connection", async () => {
      const result = await getPowerCurve.execute(
        { days: 90 },
        { userId: USER_NO_CONNECTION, db }
      );
      expect(result).toEqual({ available: false, reason: "no_connection" });
    });

    // Without this, `expect(result.stale).toBe(false)` above is vacuous: it
    // passes just as happily against a tool that hardcodes `stale: false`,
    // which was a surviving mutation before this test existed. The coach
    // needs to know a number is hours or days old, and the fresh-cache path
    // alone can never prove the flag is wired to anything.
    //
    // The seeded row is past the TTL, so the real fetcher runs and fails
    // (no-network) — the production shape of "intervals.icu is down, here is
    // what we last knew". The data must still come through, because a stale
    // PR curve is far more useful to the coach than silence.
    it("serves an expired curve marked stale rather than going quiet", async () => {
      const result = (await getPowerCurve.execute(
        { days: 30 },
        { userId: USER_STALE, db }
      )) as {
        available: boolean;
        stale: boolean;
        fetched_at: string;
        key_points: { duration_s: number; watts: number }[];
      };

      expect(result.available).toBe(true);
      expect(result.stale).toBe(true);
      expect(result.fetched_at).toBe(STALE_FETCHED_AT.toISOString());
      expect(result.key_points).toContainEqual({ duration_s: 5, watts: 900 });
    });
  });

  describe("get_pace_curve", () => {
    it("returns the available curve with key points rounded to one decimal", async () => {
      const result = (await getPaceCurve.execute(
        { days: 30 },
        { userId: USER_PACE, db }
      )) as {
        available: boolean;
        stale: boolean;
        fetched_at: string;
        days: number;
        key_points: { distance_m: number; secs_per_km: number }[];
      };

      expect(result.available).toBe(true);
      expect(result.stale).toBe(false);
      expect(result.fetched_at).toBe(FETCHED_AT.toISOString());
      expect(result.days).toBe(30);
      expect(result.key_points).toEqual([
        { distance_m: 400, secs_per_km: 200.3 },
        { distance_m: 1000, secs_per_km: 211.3 },
        { distance_m: 5000, secs_per_km: 220.6 },
        { distance_m: 10000, secs_per_km: 233.2 },
        { distance_m: 21097, secs_per_km: 240.8 },
      ]);
    });

    it("tells the coach why there is no figure for a user with no connection", async () => {
      const result = await getPaceCurve.execute(
        { days: 90 },
        { userId: USER_NO_CONNECTION, db }
      );
      expect(result).toEqual({ available: false, reason: "no_connection" });
    });
  });

  describe("get_best_efforts", () => {
    it("returns the available efforts with count matching the list length", async () => {
      const result = (await getBestEfforts.execute(
        { days: 30 },
        { userId: USER_BEST_EFFORTS, db }
      )) as {
        available: boolean;
        stale: boolean;
        fetched_at: string;
        days: number;
        efforts: unknown[];
        count: number;
      };

      expect(result.available).toBe(true);
      expect(result.stale).toBe(false);
      expect(result.fetched_at).toBe(FETCHED_AT.toISOString());
      expect(result.days).toBe(30);
      expect(result.efforts).toEqual(BEST_EFFORTS_DATA);
      expect(result.count).toBe(BEST_EFFORTS_DATA.length);
      expect(result.count).toBe(result.efforts.length);
    });

    it("tells the coach why there is no figure for a user with no connection", async () => {
      const result = await getBestEfforts.execute(
        { days: 90 },
        { userId: USER_NO_CONNECTION, db }
      );
      expect(result).toEqual({ available: false, reason: "no_connection" });
    });

    it("filters by sport, case-insensitively, and counts only the matches", async () => {
      const result = (await getBestEfforts.execute(
        { days: 30, sport: "ride" },
        { userId: USER_BEST_EFFORTS, db }
      )) as { efforts: { sport: string }[]; count: number };

      expect(result.efforts).toHaveLength(2);
      expect(result.efforts.every((e) => e.sport === "Ride")).toBe(true);
      expect(result.count).toBe(2);

      const runResult = (await getBestEfforts.execute(
        { days: 30, sport: "Run" },
        { userId: USER_BEST_EFFORTS, db }
      )) as { efforts: { sport: string }[]; count: number };

      expect(runResult.efforts).toHaveLength(1);
      expect(runResult.efforts[0].sport).toBe("Run");
      expect(runResult.count).toBe(1);
    });
  });
});
