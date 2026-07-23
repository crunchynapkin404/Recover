import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { and, eq } from "drizzle-orm";

// v0.6 auto-describe integration: guards, fresh write, append, skip marker,
// auth-failure flag flip, and the coach tool. Requires Postgres.
const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

const USER = "test-describer-user";
const STRAVA_ID = "999888";

process.env.STRAVA_CLIENT_ID ??= "test-client";
process.env.STRAVA_CLIENT_SECRET ??= "test-secret";
process.env.ENCRYPTION_KEY ??=
  "0000000000000000000000000000000000000000000000000000000000000000";

interface PutCall {
  url: string;
  body: { description: string };
}

/** Route stubbed fetch: intervals.icu → 500 (best-efforts cache degrades
 * gracefully), Strava GET → existing description, Strava PUT → captured. */
function stubStrava(existing: string | null, puts: PutCall[], putStatus = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("intervals.icu")) {
        return new Response("[]", { status: 500 });
      }
      if (url.includes("strava.com/api/v3/activities/")) {
        if (init?.method === "PUT") {
          puts.push({ url, body: JSON.parse(String(init.body)) });
          return new Response("{}", { status: putStatus });
        }
        return new Response(JSON.stringify({ description: existing }), {
          status: 200,
        });
      }
      return new Response("{}", { status: 200 });
    })
  );
}

describe.skipIf(!hasDb)("strava auto-describe", () => {
  beforeAll(async () => {
    const { db, schema } = await import("@/lib/db");
    await db
      .insert(schema.users)
      .values({
        id: USER,
        name: "Describer Test",
        email: "describer-test@example.invalid",
      })
      .onConflictDoNothing();
  });

  afterAll(async () => {
    const { db, schema } = await import("@/lib/db");
    await db
      .delete(schema.activities)
      .where(eq(schema.activities.userId, USER));
    await db
      .delete(schema.wellnessDaily)
      .where(eq(schema.wellnessDaily.userId, USER));
    await db.delete(schema.users).where(eq(schema.users.id, USER));
  });

  beforeEach(async () => {
    const { db, schema } = await import("@/lib/db");
    const { encrypt } = await import("@/lib/crypto");

    // Baseline: opted in, write-enabled connection, one fresh intervals
    // activity linked to a Strava activity, wellness for form metrics.
    await db
      .insert(schema.notificationPrefs)
      .values({ userId: USER, autoDescribeStrava: true })
      .onConflictDoUpdate({
        target: schema.notificationPrefs.userId,
        set: { autoDescribeStrava: true },
      });

    await db
      .delete(schema.connections)
      .where(eq(schema.connections.userId, USER));
    await db.insert(schema.connections).values({
      userId: USER,
      provider: "strava",
      encryptedAccessToken: encrypt("write-access"),
      encryptedRefreshToken: encrypt("write-refresh"),
      externalAthleteId: "77",
      expiresAt: new Date(Date.now() + 3600_000), // valid — no refresh call
      status: "active",
      stravaWriteEnabled: true,
    });

    await db
      .delete(schema.activities)
      .where(eq(schema.activities.userId, USER));
    await db.insert(schema.activities).values({
      userId: USER,
      provider: "intervals_icu",
      externalId: "i-desc-1",
      startDate: new Date(),
      sport: "Ride",
      name: "Morning intervals",
      durationS: 3600,
      distanceM: 30000,
      load: 85,
      raw: {
        strava_id: STRAVA_ID,
        icu_training_load: 85,
        icu_intensity: 0.87,
        trimp: 112,
        power_hr_ratio: 1.58,
        hr_decoupling: 3.2,
        carbs_per_hour: 62,
        icu_ftp: 286,
        icu_vo2max_estimate: 52.3,
      },
    });

    const today = new Date().toISOString().slice(0, 10);
    await db
      .insert(schema.wellnessDaily)
      .values({ userId: USER, date: today, ctl: 72.4, atl: 84.7 })
      .onConflictDoUpdate({
        target: [schema.wellnessDaily.userId, schema.wellnessDaily.date],
        set: { ctl: 72.4, atl: 84.7 },
      });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("writes a fresh description with metrics and the marker", async () => {
    const { runAutoDescribeStrava, MARKER } =
      await import("@/lib/strava-describer");
    const puts: PutCall[] = [];
    stubStrava(null, puts);

    const result = await runAutoDescribeStrava(USER);

    expect(result.written).toBe(1);
    expect(puts).toHaveLength(1);
    expect(puts[0].url).toContain(`/activities/${STRAVA_ID}`);
    const text = puts[0].body.description;
    expect(text).toContain("🚴 Morning intervals");
    expect(text).toContain("🔋 Load: TL 85 | IF 87% | TRIMP 112");
    expect(text).toContain("⚡ Efficiency: Pw:Hr 1.58 | decoupling 3.2%");
    expect(text).toContain("🍔 Carbs: ~62 g/u");
    expect(text).toContain("📈 Form: CTL 72 | TSB -12 | eFTP 286 W | VO2 52.3");
    expect(text.endsWith(MARKER)).toBe(true);
  });

  it("writes onto a Strava-sourced activity whose raw payload has no strava_id, using its own externalId", async () => {
    const { db, schema } = await import("@/lib/db");
    // intervals.icu withholds strava_id/metrics for activities it sourced
    // from Strava — this row's externalId (an intervals.icu id borrowed
    // from Strava for these) is the only way to find where to write.
    await db
      .update(schema.activities)
      .set({
        externalId: STRAVA_ID,
        raw: { source: "STRAVA" },
        durationS: null,
        load: null,
      })
      .where(eq(schema.activities.userId, USER));

    const puts: PutCall[] = [];
    stubStrava(null, puts);

    const { runAutoDescribeStrava } = await import("@/lib/strava-describer");
    const result = await runAutoDescribeStrava(USER);

    expect(result.written).toBe(1);
    expect(puts).toHaveLength(1);
    expect(puts[0].url).toContain(`/activities/${STRAVA_ID}`);
    // Only CTL/TSB (from wellness) survive — everything raw-derived is
    // absent, matching intervals.icu's actual withheld payload.
    expect(puts[0].body.description).toContain("📈 Form: CTL 72 | TSB -12");
  });

  it("appends below an existing description", async () => {
    const { runAutoDescribeStrava } = await import("@/lib/strava-describer");
    const puts: PutCall[] = [];
    stubStrava("Great ride with the club", puts);

    await runAutoDescribeStrava(USER);

    expect(puts).toHaveLength(1);
    expect(
      puts[0].body.description.startsWith("Great ride with the club\n\n---\n")
    ).toBe(true);
  });

  it("skips when the marker is already present (no double writes)", async () => {
    const { runAutoDescribeStrava, MARKER } =
      await import("@/lib/strava-describer");
    const puts: PutCall[] = [];
    stubStrava("already described" + MARKER, puts);

    const result = await runAutoDescribeStrava(USER);

    expect(puts).toHaveLength(0);
    expect(result.written).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it("does nothing when the user has not opted in", async () => {
    const { db, schema } = await import("@/lib/db");
    await db
      .update(schema.notificationPrefs)
      .set({ autoDescribeStrava: false })
      .where(eq(schema.notificationPrefs.userId, USER));

    const { runAutoDescribeStrava } = await import("@/lib/strava-describer");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await runAutoDescribeStrava(USER);
    expect(result).toEqual({ written: 0, skipped: 0, reason: "disabled" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does nothing without the write scope", async () => {
    const { db, schema } = await import("@/lib/db");
    await db
      .update(schema.connections)
      .set({ stravaWriteEnabled: false })
      .where(
        and(
          eq(schema.connections.userId, USER),
          eq(schema.connections.provider, "strava")
        )
      );

    const { runAutoDescribeStrava } = await import("@/lib/strava-describer");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await runAutoDescribeStrava(USER);
    expect(result.reason).toBe("no_write_scope");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("disables the write flag on an auth failure instead of retrying", async () => {
    const { runAutoDescribeStrava } = await import("@/lib/strava-describer");
    const { db, schema } = await import("@/lib/db");
    const puts: PutCall[] = [];
    stubStrava(null, puts, 401);

    const result = await runAutoDescribeStrava(USER);
    expect(result.written).toBe(0);

    const connection = await db.query.connections.findFirst({
      where: and(
        eq(schema.connections.userId, USER),
        eq(schema.connections.provider, "strava")
      ),
    });
    expect(connection!.stravaWriteEnabled).toBe(false);
  });

  it("describe_strava_activity tool writes and never echoes Strava text", async () => {
    const { allTools } = await import("@/lib/tools/registry");
    const { db } = await import("@/lib/db");
    const tool = allTools.find((t) => t.name === "describe_strava_activity")!;
    expect(tool.scope).toBe("write:strava");

    const puts: PutCall[] = [];
    stubStrava("SECRET existing strava text", puts);

    const out = (await tool.execute({}, { userId: USER, db })) as {
      written: boolean;
      description: string;
    };

    expect(out.written).toBe(true);
    expect(puts).toHaveLength(1);
    // The merged PUT contains the existing text (append mode)…
    expect(puts[0].body.description).toContain("SECRET existing strava text");
    // …but the tool result (LLM-visible) must only carry the generated block.
    expect(JSON.stringify(out)).not.toContain("SECRET");
    expect(out.description).toContain("🔋 Load: TL 85");
  });
});
