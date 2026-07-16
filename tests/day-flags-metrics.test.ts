import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { DayFlag } from "@/lib/day-flags";

// v0.7 score integrity: flagged days are excluded from the baselines every
// later day is measured against — but are still scored themselves.
// Requires Postgres; skips without it.
const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

const USER = "test-day-flags-user";
/**
 * Normal days vary — a constant series has sd 0, which the engine reads as
 * z = 0 (score 50) for everything, hiding exactly what these tests measure.
 */
const normalHrv = (n: number) => 58 + (n % 5); // 58..62
const normalRhr = (n: number) => 49 + (n % 3); // 49..51
/** Crushed values, as during illness. */
const ILL_HRV = 25;
const ILL_RHR = 70;

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
/** The baseline days 0..15 are the only *normal* days in these fixtures. */
const NORMAL_DAYS = Array.from({ length: 16 }, (_, n) => n);
const EXPECTED_LN_HRV_MEAN = mean(
  NORMAL_DAYS.map((n) => Math.log(normalHrv(n)))
);
const EXPECTED_RHR_MEAN = mean(NORMAL_DAYS.map((n) => normalRhr(n)));

/** Fixed, far-past window so this never collides with real data. */
const BASE = new Date(2025, 0, 6); // Mon 2025-01-06, local

function dayN(n: number): string {
  const d = new Date(BASE);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function seedDay(
  n: number,
  opts: { hrv: number; rhr: number; dayFlags?: DayFlag[] }
) {
  const { db, schema } = await import("@/lib/db");
  await db
    .insert(schema.wellnessDaily)
    .values({
      userId: USER,
      date: dayN(n),
      hrvMs: opts.hrv,
      restingHr: opts.rhr,
      dayFlags: opts.dayFlags ?? null,
      source: "manual",
    })
    .onConflictDoUpdate({
      target: [schema.wellnessDaily.userId, schema.wellnessDaily.date],
      set: {
        hrvMs: opts.hrv,
        restingHr: opts.rhr,
        dayFlags: opts.dayFlags ?? null,
      },
    });
}

async function setFlags(n: number, flags: DayFlag[] | null) {
  const { db, schema } = await import("@/lib/db");
  await db
    .update(schema.wellnessDaily)
    .set({ dayFlags: flags })
    .where(
      and(
        eq(schema.wellnessDaily.userId, USER),
        eq(schema.wellnessDaily.date, dayN(n))
      )
    );
}

async function metricFor(n: number) {
  const { db, schema } = await import("@/lib/db");
  return db.query.dailyMetrics.findFirst({
    where: and(
      eq(schema.dailyMetrics.userId, USER),
      eq(schema.dailyMetrics.date, dayN(n))
    ),
  });
}

async function cleanup() {
  const { db, schema } = await import("@/lib/db");
  await db
    .delete(schema.dailyMetrics)
    .where(eq(schema.dailyMetrics.userId, USER));
  await db
    .delete(schema.wellnessDaily)
    .where(eq(schema.wellnessDaily.userId, USER));
  await db.delete(schema.users).where(eq(schema.users.id, USER));
}

describe.skipIf(!hasDb)("day flags and baselines", () => {
  beforeEach(async () => {
    await cleanup();
    const { db, schema } = await import("@/lib/db");
    await db
      .insert(schema.users)
      .values({
        id: USER,
        name: "DayFlags Test",
        email: "day-flags@example.invalid",
      })
      .onConflictDoNothing();
    // Days 0..15 — sixteen normal days, clearing MIN_BASELINE_DAYS (14).
    for (const n of NORMAL_DAYS) {
      await seedDay(n, { hrv: normalHrv(n), rhr: normalRhr(n) });
    }
  });

  afterAll(cleanup);

  it("excludes a flagged day from every later day's baseline", async () => {
    const { computeDailyMetrics } = await import("@/lib/metrics");
    // Day 16 is a crushed, flagged illness day; day 17 is back to normal.
    await seedDay(16, { hrv: ILL_HRV, rhr: ILL_RHR, dayFlags: ["ill"] });
    await seedDay(17, { hrv: normalHrv(17), rhr: normalRhr(17) });
    await computeDailyMetrics(USER, dayN(0));

    const day17 = await metricFor(17);
    // The surviving baseline is exactly the normal days, so its mean of
    // ln(hrv) matches — proof the flagged 25 never entered the array.
    expect(day17!.hrvBaselineMean).toBeCloseTo(EXPECTED_LN_HRV_MEAN, 6);
    expect(day17!.rhrBaselineMean).toBeCloseTo(EXPECTED_RHR_MEAN, 6);
    // A normal day against an uncontaminated baseline sits mid-band.
    expect(day17!.band).not.toBe("calibrating");
  });

  it("contaminates the baseline when the same day is NOT flagged", async () => {
    const { computeDailyMetrics } = await import("@/lib/metrics");
    await seedDay(16, { hrv: ILL_HRV, rhr: ILL_RHR }); // no flag
    await seedDay(17, { hrv: normalHrv(17), rhr: normalRhr(17) });
    await computeDailyMetrics(USER, dayN(0));

    const day17 = await metricFor(17);
    // The control: without the flag the crushed day drags the reference down.
    expect(day17!.hrvBaselineMean).toBeLessThan(EXPECTED_LN_HRV_MEAN);
    expect(day17!.rhrBaselineMean).toBeGreaterThan(EXPECTED_RHR_MEAN);
  });

  it("still scores the flagged day itself — exclusion is baseline-only", async () => {
    const { computeDailyMetrics } = await import("@/lib/metrics");
    await seedDay(16, { hrv: ILL_HRV, rhr: ILL_RHR, dayFlags: ["ill"] });
    await computeDailyMetrics(USER, dayN(0));

    const day16 = await metricFor(16);
    expect(day16).toBeDefined();
    expect(day16!.readiness).not.toBeNull();
    expect(day16!.band).toBe("red"); // crushed HRV/RHR against a normal baseline
  });

  it("falls back to calibrating when too much of the window is flagged", async () => {
    const { computeDailyMetrics } = await import("@/lib/metrics");
    // Flag all but 3 of the sixteen baseline days — below MIN_BASELINE_DAYS.
    for (let n = 0; n < 13; n++) await setFlags(n, ["ill"]);
    await seedDay(16, { hrv: normalHrv(16), rhr: normalRhr(16) });
    await computeDailyMetrics(USER, dayN(0));

    const day16 = await metricFor(16);
    // Honest degradation: too little reference left → say so, don't guess.
    expect(day16!.band).toBe("calibrating");
    expect(day16!.readiness).toBeNull();
  });

  it("recomputes back when a day is unflagged — exclusion is not one-way", async () => {
    const { computeDailyMetrics } = await import("@/lib/metrics");
    await seedDay(16, { hrv: ILL_HRV, rhr: ILL_RHR, dayFlags: ["ill"] });
    await seedDay(17, { hrv: normalHrv(17), rhr: normalRhr(17) });
    await computeDailyMetrics(USER, dayN(0));
    expect((await metricFor(17))!.hrvBaselineMean).toBeCloseTo(
      EXPECTED_LN_HRV_MEAN,
      6
    );

    await setFlags(16, []); // athlete clears the flag
    await computeDailyMetrics(USER, dayN(0));
    expect((await metricFor(17))!.hrvBaselineMean).toBeLessThan(
      EXPECTED_LN_HRV_MEAN
    );
  });

  it("treats null and [] identically — both are a normal day", async () => {
    const { computeDailyMetrics } = await import("@/lib/metrics");
    await seedDay(16, { hrv: ILL_HRV, rhr: ILL_RHR, dayFlags: [] });
    await seedDay(17, { hrv: normalHrv(17), rhr: normalRhr(17) });
    await computeDailyMetrics(USER, dayN(0));
    const withEmpty = (await metricFor(17))!.hrvBaselineMean;

    await setFlags(16, null);
    await computeDailyMetrics(USER, dayN(0));
    const withNull = (await metricFor(17))!.hrvBaselineMean;

    expect(withEmpty).toBeCloseTo(withNull!, 9);
    expect(withNull).toBeLessThan(EXPECTED_LN_HRV_MEAN); // both included
  });
});
