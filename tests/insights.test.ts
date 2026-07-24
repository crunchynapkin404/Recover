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

    // Milestone fixtures: 3 consecutive journaled days ending today, one
    // plan with a completed and an incomplete week, one finished plan.
    await db.insert(schema.wellnessDaily).values(
      [0, 1, 2].map((i) => ({
        userId: USER,
        date: daysAgoYmd(i),
        mood: "good",
        source: "manual" as const,
      }))
    );
    const [plan] = await db
      .insert(schema.trainingPlans)
      .values({
        userId: USER,
        title: "Insights test plan",
        raceType: "marathon",
        raceDate: daysAgoYmd(-30),
        startDate: daysAgoYmd(30),
        weeksTotal: 8,
        currentWeek: 3,
        status: "completed",
        constraints: { daysPerWeek: 4, hoursPerWeek: 6, sports: ["Run"] },
      })
      .returning();
    await db.insert(schema.trainingBlocks).values([
      {
        planId: plan.id,
        weekNumber: 1,
        phase: "base",
        targetLoadTotal: 300,
        targetSessions: 4,
        workouts: [],
        adherencePct: 82,
      },
      {
        planId: plan.id,
        weekNumber: 2,
        phase: "base",
        targetLoadTotal: 300,
        targetSessions: 4,
        workouts: [],
        adherencePct: 55,
      },
    ]);
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

  it("milestones derive from durable rows", async () => {
    const { getMilestones } = await import("@/lib/insights/milestones");
    const m = await getMilestones(USER);
    expect(m.currentStreak).toBe(3);
    expect(m.bestStreak).toBeGreaterThanOrEqual(3);
    expect(m.planWeeksCompleted).toBe(1); // 82% counts, 55% doesn't
    expect(m.plansCompleted).toBe(1);
  });
});

describe.skipIf(!hasDb)("insights integration — timezone", () => {
  const TZ_USER = "test-insights-tz-user";

  async function tzCleanup() {
    const { db, schema } = await import("@/lib/db");
    await db.delete(schema.users).where(eq(schema.users.id, TZ_USER));
  }

  beforeAll(async () => {
    const { db, schema } = await import("@/lib/db");
    await tzCleanup();
    await db
      .insert(schema.users)
      .values({
        id: TZ_USER,
        name: "TZInsightsTest",
        email: "tz-insights@example.invalid",
        role: "member",
      })
      .onConflictDoNothing();

    // 6 sessions whose true-UTC startDate sits ~150 days back (well outside
    // the 90-day WINDOW_DAYS, so the OLD gte(startDate, ...) boundary would
    // drop every one of these rows) but whose startDateLocal — the
    // athlete's real wall-clock time — is within the window at 20:00
    // (>= LATE_FROM_HOUR). The 150-day gap swamps any possible timezone
    // offset, so which day/whether-in-window each row lands on is
    // unambiguous regardless of the host's local timezone. Local getters on
    // startDateLocal (built from explicit y/m/d/h/m/s, not a parsed string)
    // round-trip exactly, per this repo's TZ-safe test convention.
    const acts = [];
    for (let i = 10; i <= 15; i++) {
      const dayYmd = daysAgoYmd(i);
      const [y, m, d] = dayYmd.split("-").map(Number);
      acts.push({
        userId: TZ_USER,
        provider: "intervals_icu" as const,
        externalId: `tz-late-${i}`,
        startDate: new Date(Date.UTC(y, m - 1, d - 150, 12, 0, 0)),
        startDateLocal: new Date(y, m - 1, d, 20, 0, 0),
        sport: "Run",
        durationS: 1800,
        load: 5,
      });
    }
    await db.insert(schema.activities).values(acts);

    const metrics = [];
    for (let i = 0; i <= 70; i++) {
      metrics.push({
        userId: TZ_USER,
        date: daysAgoYmd(i),
        readiness: 65 + (i % 7),
        band: "green" as const,
      });
    }
    await db.insert(schema.dailyMetrics).values(metrics);
  });

  afterAll(tzCleanup);

  it("buckets and times auto-tags by startDateLocal, not true-UTC startDate", async () => {
    const { computeTagInsights } = await import("@/lib/insights/correlations");
    const rows = await computeTagInsights(TZ_USER);
    const late = rows.find((r) => r.behavior === "Late training");
    expect(late).toBeDefined();
    expect(late!.auto).toBe(true);
    expect(late!.events).toBe(6);
  });
});
