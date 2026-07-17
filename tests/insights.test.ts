import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

const USER = "test-insights-user";

function localYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function daysAgoYmd(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return localYmd(d);
}

async function cleanup() {
  const { db, schema } = await import("@/lib/db");
  await db.delete(schema.users).where(eq(schema.users.id, USER));
}

describe.skipIf(!hasDb)("insights integration", () => {
  beforeAll(async () => {
    const { db, schema } = await import("@/lib/db");
    await cleanup();
    await db
      .insert(schema.users)
      .values({
        id: USER,
        name: "InsightsTest",
        email: "insights@example.invalid",
        role: "member",
      })
      .onConflictDoNothing();

    // 19 non-Strava easy days + 5 Strava heavy days. If Strava leaked,
    // that's 24 training days (≥20) and 🔥 would fire; excluded, it's 19
    // (<20) and 🔥 stays calibrating-silent.
    const acts = [];
    for (let i = 1; i <= 19; i++) {
      acts.push({
        userId: USER,
        provider: "intervals_icu" as const,
        externalId: `ins-easy-${i}`,
        startDate: new Date(`${daysAgoYmd(i + 10)}T08:00:00`),
        sport: "Run",
        durationS: 3600,
        load: 10,
      });
    }
    for (let i = 1; i <= 5; i++) {
      acts.push({
        userId: USER,
        provider: "strava" as const,
        externalId: `ins-strava-${i}`,
        startDate: new Date(`${daysAgoYmd(i + 40)}T08:00:00`),
        sport: "Run",
        durationS: 3600,
        load: 100,
      });
    }
    await db.insert(schema.activities).values(acts);

    // Readiness for the whole window so rows can form.
    const metrics = [];
    for (let i = 0; i <= 60; i++) {
      metrics.push({
        userId: USER,
        date: daysAgoYmd(i),
        readiness: 70 + (i % 5),
        band: "green" as const,
      });
    }
    await db.insert(schema.dailyMetrics).values(metrics);
  });

  afterAll(cleanup);

  it("derives auto-tag insight rows without user input", async () => {
    const { computeTagInsights } = await import("@/lib/insights/correlations");
    const rows = await computeTagInsights(USER);
    const morning = rows.find((r) => r.behavior === "Morning training");
    expect(morning).toBeDefined();
    expect(morning!.auto).toBe(true);
    expect(morning!.events).toBeGreaterThanOrEqual(5);
  });

  it("excludes Strava activities from auto-tag derivation", async () => {
    const { computeTagInsights } = await import("@/lib/insights/correlations");
    const rows = await computeTagInsights(USER);
    expect(rows.find((r) => r.behavior === "Hard session")).toBeUndefined();
  });
});
