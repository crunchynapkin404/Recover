import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

// Coach context integration tests. Requires Postgres.
const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

const USER = "test-coach-context-user";

function localYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function cleanup() {
  const { db, schema } = await import("@/lib/db");
  await db
    .delete(schema.wellnessDaily)
    .where(eq(schema.wellnessDaily.userId, USER));
  await db
    .delete(schema.dailyMetrics)
    .where(eq(schema.dailyMetrics.userId, USER));
}

describe.skipIf(!hasDb)("fetchAthleteContext", () => {
  beforeAll(async () => {
    await cleanup();
    const { db, schema } = await import("@/lib/db");
    await db
      .insert(schema.users)
      .values({
        id: USER,
        name: "Coach Context",
        email: "coach-context@example.invalid",
        role: "member",
      })
      .onConflictDoNothing();
  });

  beforeEach(cleanup);
  afterAll(async () => {
    await cleanup();
    const { db, schema } = await import("@/lib/db");
    await db.delete(schema.users).where(eq(schema.users.id, USER));
  });

  it("names a same-day reading gap, not calibrating, for an already-calibrated athlete", async () => {
    const { db, schema } = await import("@/lib/db");
    const { fetchAthleteContext } = await import("@/lib/coach-context");
    const today = new Date();
    await db.insert(schema.wellnessDaily).values(
      Array.from({ length: 14 }, (_, i) => {
        const d = new Date(today);
        d.setDate(d.getDate() - (14 - i));
        return { userId: USER, date: localYmd(d), hrvMs: 60, restingHr: 50 };
      })
    );
    // No daily_metrics row at all → no readiness computed today.

    const context = await fetchAthleteContext(USER, db);
    expect(context).toContain("Needs a readiness score today");
    expect(context).not.toContain("Calibrating");
  });

  it("still says calibrating for a genuinely new athlete", async () => {
    const { db } = await import("@/lib/db");
    const { fetchAthleteContext } = await import("@/lib/coach-context");
    // No wellness_daily or daily_metrics rows at all.
    const context = await fetchAthleteContext(USER, db);
    expect(context).toContain("Calibrating — day 0 of 14 days");
  });

  it("reports Training Load from daily_metrics with no wellness_daily row at all (manual-only athlete)", async () => {
    const { db, schema } = await import("@/lib/db");
    const { fetchAthleteContext } = await import("@/lib/coach-context");
    const today = new Date();
    // The bug this fixes: the old code read ctl/atl from latestWellness,
    // picked from wellness_daily for HRV/RHR/sleep presence — a
    // manual-only athlete has no such row, so Training Load was silently
    // omitted even on a day daily_metrics resolved a real number.
    await db.insert(schema.dailyMetrics).values({
      userId: USER,
      date: localYmd(today),
      ctl: 45,
      atl: 40,
      tsb: 5,
      readiness: 70,
      band: "green",
    });

    const context = await fetchAthleteContext(USER, db);
    expect(context).toContain("Training Load:");
    expect(context).toContain("CTL=45");
    expect(context).toContain("ATL=40");
    expect(context).toContain("TSB=5");
  });

  it("still recognizes an already-calibrated athlete when their history sits outside the trailing 14 days", async () => {
    const { db, schema } = await import("@/lib/db");
    const { fetchAthleteContext } = await import("@/lib/coach-context");
    const today = new Date();
    // 20 real HRV/RHR days, all 31–50 days ago — well clear of the 14-day
    // target, but also well outside a naive 14-day lookback window.
    await db.insert(schema.wellnessDaily).values(
      Array.from({ length: 20 }, (_, i) => {
        const d = new Date(today);
        d.setDate(d.getDate() - (50 - i));
        return { userId: USER, date: localYmd(d), hrvMs: 60, restingHr: 50 };
      })
    );
    // No daily_metrics row at all → no readiness computed today.

    const context = await fetchAthleteContext(USER, db);
    expect(context).toContain("Needs a readiness score today");
    expect(context).not.toContain("Calibrating");
  });
});
