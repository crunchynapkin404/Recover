import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { and, eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";

// Strava layer tests (P5): token refresh under the advisory lock (single
// refresh even with concurrent syncs) and the AI-exclusion filter proving
// provider='strava' rows never reach tool output. Requires Postgres.
const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

const USER = "test-strava-user";

process.env.STRAVA_CLIENT_ID ??= "test-client";
process.env.STRAVA_CLIENT_SECRET ??= "test-secret";

function tokenResponse(n: number) {
  return new Response(
    JSON.stringify({
      access_token: `fresh-access-${n}`,
      refresh_token: `fresh-refresh-${n}`,
      expires_at: Math.floor(Date.now() / 1000) + 6 * 3600,
    }),
    { status: 200 }
  );
}

describe.skipIf(!hasDb)("strava layer", () => {
  beforeAll(async () => {
    const { db, schema } = await import("@/lib/db");
    await db
      .insert(schema.users)
      .values({
        id: USER,
        name: "Strava Test",
        email: "strava-test@example.invalid",
      })
      .onConflictDoNothing();
  });

  afterAll(async () => {
    const { db, schema } = await import("@/lib/db");
    await db
      .delete(schema.activities)
      .where(eq(schema.activities.userId, USER));
    await db
      .delete(schema.connections)
      .where(eq(schema.connections.userId, USER));
    await db.delete(schema.users).where(eq(schema.users.id, USER));
  });

  afterEach(() => vi.unstubAllGlobals());

  it("refreshes an expired token exactly once under concurrency", async () => {
    const { db, schema } = await import("@/lib/db");
    const { encrypt, decrypt } = await import("@/lib/crypto");
    const { getValidStravaAccessToken } =
      await import("@/lib/sync/strava-sync");

    await db
      .delete(schema.connections)
      .where(eq(schema.connections.userId, USER));
    const [connection] = await db
      .insert(schema.connections)
      .values({
        userId: USER,
        provider: "strava",
        encryptedAccessToken: encrypt("stale-access"),
        encryptedRefreshToken: encrypt("stale-refresh"),
        externalAthleteId: "12345",
        expiresAt: new Date(Date.now() - 1000), // expired
        status: "active",
      })
      .returning();

    let refreshCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => {
        refreshCalls++;
        await new Promise((r) => setTimeout(r, 25));
        return tokenResponse(refreshCalls);
      })
    );

    const [a, b] = await Promise.all([
      getValidStravaAccessToken(connection),
      getValidStravaAccessToken(connection),
    ]);

    // The advisory lock serializes: exactly one network refresh; the loser
    // re-reads the fresh row instead of burning the single-use refresh token.
    expect(refreshCalls).toBe(1);
    expect(a).toBe("fresh-access-1");
    expect(b).toBe("fresh-access-1");

    const stored = await db.query.connections.findFirst({
      where: eq(schema.connections.id, connection.id),
    });
    expect(decrypt(stored!.encryptedRefreshToken!)).toBe("fresh-refresh-1");
    expect(stored!.expiresAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it("returns the current token untouched when not near expiry", async () => {
    const { db, schema } = await import("@/lib/db");
    const { encrypt } = await import("@/lib/crypto");
    const { getValidStravaAccessToken } =
      await import("@/lib/sync/strava-sync");

    await db
      .delete(schema.connections)
      .where(eq(schema.connections.userId, USER));
    const [connection] = await db
      .insert(schema.connections)
      .values({
        userId: USER,
        provider: "strava",
        encryptedAccessToken: encrypt("valid-access"),
        encryptedRefreshToken: encrypt("valid-refresh"),
        externalAthleteId: "12345",
        expiresAt: new Date(Date.now() + 3600_000),
        status: "active",
      })
      .returning();

    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(await getValidStravaAccessToken(connection)).toBe("valid-access");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("excludes strava-sourced activities from every AI/MCP tool", async () => {
    const { db, schema } = await import("@/lib/db");
    const { allTools } = await import("@/lib/tools/registry");

    const stravaName = `Strava ride ${randomBytes(4).toString("hex")}`;
    const intervalsName = `Intervals ride ${randomBytes(4).toString("hex")}`;
    const [stravaRow] = await db
      .insert(schema.activities)
      .values([
        {
          userId: USER,
          provider: "strava",
          externalId: "s-1",
          startDate: new Date(),
          sport: "Ride",
          name: stravaName,
          load: 100,
        },
        {
          userId: USER,
          provider: "intervals_icu",
          externalId: "i-1",
          startDate: new Date(),
          sport: "Ride",
          name: intervalsName,
          load: 80,
        },
      ])
      .returning();

    const ctx = { userId: USER, db };

    const list = allTools.find((t) => t.name === "list_activities")!;
    const listOut = JSON.stringify(await list.execute({ days: 7 }, ctx));
    expect(listOut).toContain(intervalsName);
    expect(listOut).not.toContain(stravaName);

    const getOne = allTools.find((t) => t.name === "get_activity")!;
    const oneOut = (await getOne.execute({ id: stravaRow.id }, ctx)) as {
      found: boolean;
    };
    expect(oneOut.found).toBe(false);

    const loadSummary = allTools.find(
      (t) => t.name === "get_training_load_summary"
    )!;
    const summary = (await loadSummary.execute({}, ctx)) as {
      weeks: Array<{ load: number }>;
    };
    expect(summary.weeks.at(-1)!.load).toBe(80); // strava's 100 not counted
  });
});
