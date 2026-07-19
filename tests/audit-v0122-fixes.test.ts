import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";

// v0.12.2 audit fixes:
// 1. Strava rows must not feed the native CTL/ATL series (it reaches coach
//    context and MCP tools via readiness — the Nov-2024 Strava agreement
//    bars API data from AI surfaces, aggregates included).
// 2. wellness field_sources is written as a jsonb union, so concurrent
//    writers can't erase each other's ownership records.
// 3. refreshDailyDecay writes today's daily_metrics row for users nothing
//    else touches, so EMAs decay through restful days.
// 4. The Apple Health ingest webhook rejects oversized payloads.
// DB suites require Postgres; they skip without it.
const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

const USER = "test-audit-v0122-user";

/** Fixed, far-past window so this never collides with real data. */
const BASE = new Date(2025, 2, 3); // Mon 2025-03-03, local

function dayN(n: number): string {
  const d = new Date(BASE);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function localToday(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

async function seedActivity(
  n: number,
  provider: "strava" | "manual",
  externalId: string
) {
  const { db, schema } = await import("@/lib/db");
  const start = new Date(BASE);
  start.setDate(start.getDate() + n);
  start.setHours(9, 0, 0, 0);
  await db
    .insert(schema.activities)
    .values({
      userId: USER,
      provider,
      externalId,
      startDate: start,
      sport: "Ride",
      durationS: 3600,
      load: provider === "strava" ? 80 : null,
    })
    .onConflictDoNothing();
}

async function cleanup() {
  const { db, schema } = await import("@/lib/db");
  await db.delete(schema.activities).where(eq(schema.activities.userId, USER));
  await db
    .delete(schema.dailyMetrics)
    .where(eq(schema.dailyMetrics.userId, USER));
  await db
    .delete(schema.wellnessDaily)
    .where(eq(schema.wellnessDaily.userId, USER));
  await db.delete(schema.users).where(eq(schema.users.id, USER));
}

async function ensureUser() {
  const { db, schema } = await import("@/lib/db");
  await db
    .insert(schema.users)
    .values({
      id: USER,
      name: "Audit Fixes Test",
      email: "audit-v0122@example.invalid",
    })
    .onConflictDoNothing();
}

describe.skipIf(!hasDb)("native load excludes Strava (AI firewall)", () => {
  beforeEach(async () => {
    await cleanup();
    await ensureUser();
  });
  afterAll(cleanup);

  it("strava-only history stays calibrating; manual sessions compute", async () => {
    const { db, schema } = await import("@/lib/db");
    const { computeDailyMetrics } = await import("@/lib/metrics");

    // Eight Strava days with provider load — plenty, if they counted.
    for (let n = 0; n < 8; n++) await seedActivity(n, "strava", `s-${n}`);
    await computeDailyMetrics(USER, dayN(0));

    const rows = await db.query.dailyMetrics.findMany({
      where: eq(schema.dailyMetrics.userId, USER),
    });
    expect(rows.every((r) => r.ctl == null && r.atl == null)).toBe(true);

    // The same days as manual sessions clear the calibrating gate.
    for (let n = 0; n < 8; n++) await seedActivity(n, "manual", `m-${n}`);
    await computeDailyMetrics(USER, dayN(0));

    const day7 = await db.query.dailyMetrics.findFirst({
      where: and(
        eq(schema.dailyMetrics.userId, USER),
        eq(schema.dailyMetrics.date, dayN(7))
      ),
    });
    expect(day7?.ctl).not.toBeNull();
    expect(day7?.loadSource).toBe("computed");
  });
});

describe.skipIf(!hasDb)("wellness field_sources jsonb union", () => {
  beforeEach(async () => {
    await cleanup();
    await ensureUser();
  });
  afterAll(cleanup);

  it("later writers extend ownership without erasing earlier records", async () => {
    const { db, schema } = await import("@/lib/db");
    const { applyWellnessPatch } = await import("@/lib/wellness-merge");

    await applyWellnessPatch(USER, dayN(0), { hrvMs: 55 }, "whoop");
    await applyWellnessPatch(
      USER,
      dayN(0),
      { sleepScore: 80 },
      "intervals_icu"
    );

    const row = await db.query.wellnessDaily.findFirst({
      where: and(
        eq(schema.wellnessDaily.userId, USER),
        eq(schema.wellnessDaily.date, dayN(0))
      ),
    });
    expect(row?.hrvMs).toBe(55);
    expect(row?.sleepScore).toBe(80);
    expect(row?.fieldSources).toMatchObject({
      hrvMs: "whoop",
      sleepScore: "intervals_icu",
    });
  });

  it("a lower-priority source still cannot take an owned field", async () => {
    const { db, schema } = await import("@/lib/db");
    const { applyWellnessPatch } = await import("@/lib/wellness-merge");

    await applyWellnessPatch(USER, dayN(1), { hrvMs: 55 }, "whoop");
    const changed = await applyWellnessPatch(
      USER,
      dayN(1),
      { hrvMs: 60 },
      "intervals_icu"
    );
    expect(changed).toBe(false);

    const row = await db.query.wellnessDaily.findFirst({
      where: and(
        eq(schema.wellnessDaily.userId, USER),
        eq(schema.wellnessDaily.date, dayN(1))
      ),
    });
    expect(row?.hrvMs).toBe(55);
    expect(row?.fieldSources).toMatchObject({ hrvMs: "whoop" });
  });
});

describe.skipIf(!hasDb)("refreshDailyDecay", () => {
  beforeEach(async () => {
    await cleanup();
    await ensureUser();
  });
  afterAll(cleanup);

  it("writes today's row for a user with stale metrics history", async () => {
    const { db, schema } = await import("@/lib/db");
    const { refreshDailyDecay } = await import("@/lib/sync/scheduler");

    // History exists (an old computed day), but nothing for today.
    await seedActivity(0, "manual", "decay-0");
    const { computeDailyMetrics } = await import("@/lib/metrics");
    await computeDailyMetrics(USER, dayN(0));
    await db
      .delete(schema.dailyMetrics)
      .where(
        and(
          eq(schema.dailyMetrics.userId, USER),
          eq(schema.dailyMetrics.date, localToday())
        )
      );

    await refreshDailyDecay();

    const today = await db.query.dailyMetrics.findFirst({
      where: and(
        eq(schema.dailyMetrics.userId, USER),
        eq(schema.dailyMetrics.date, localToday())
      ),
    });
    expect(today).toBeDefined();
  });
});

describe("apple health ingest payload cap", () => {
  it("rejects an oversized payload before touching auth or the db", async () => {
    const { POST } =
      await import("@/app/api/connections/apple-health/ingest/route");
    const res = await POST(
      new Request("http://localhost/api/connections/apple-health/ingest", {
        method: "POST",
        headers: { "content-length": String(20 * 1024 * 1024) },
      })
    );
    expect(res.status).toBe(413);
  });
});
