import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { computeDailyMetrics } from "@/lib/metrics";
import { MIN_BASELINE_DAYS } from "@/lib/readiness";

const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

const USER = "test-hrv-source-user";

/** YYYY-MM-DD, `n` days before 2026-06-15 (a fixed date, so the test never
 *  depends on when it runs). */
function day(n: number): string {
  const d = new Date("2026-06-15T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

async function seed(
  rows: Array<{ date: string; hrvMs?: number; hrvSdnnMs?: number }>
) {
  for (const r of rows) {
    await db.insert(schema.wellnessDaily).values({
      userId: USER,
      date: r.date,
      hrvMs: r.hrvMs ?? null,
      hrvSdnnMs: r.hrvSdnnMs ?? null,
      restingHr: 50,
      source: "intervals_icu",
    });
  }
}

/** wellness_daily.user_id carries an FK to users.id, so the row has to exist
 *  before anything can be seeded against it. */
async function ensureUser() {
  await db
    .insert(schema.users)
    .values({
      id: USER,
      name: "HRV Source",
      email: "hrv-source@example.invalid",
    })
    .onConflictDoNothing();
}

async function cleanup() {
  await db
    .delete(schema.wellnessDaily)
    .where(eq(schema.wellnessDaily.userId, USER));
  await db
    .delete(schema.dailyMetrics)
    .where(eq(schema.dailyMetrics.userId, USER));
}

async function teardown() {
  await cleanup();
  await db.delete(schema.users).where(eq(schema.users.id, USER));
}

async function metricFor(date: string) {
  return db.query.dailyMetrics.findFirst({
    where: and(
      eq(schema.dailyMetrics.userId, USER),
      eq(schema.dailyMetrics.date, date)
    ),
  });
}

describe.skipIf(!hasDb)("computeDailyMetrics HRV source", () => {
  beforeEach(async () => {
    await ensureUser();
    await cleanup();
  });
  afterAll(teardown);

  it("scores an SDNN-only day against the SDNN baseline", async () => {
    // 20 days of SDNN history around 70, none of rMSSD, then a target day.
    const history = Array.from({ length: 20 }, (_, i) => ({
      date: day(20 - i),
      hrvSdnnMs: 68 + (i % 5),
    }));
    await seed([...history, { date: day(0), hrvSdnnMs: 91 }]);

    await computeDailyMetrics(USER, day(0));

    const m = await metricFor(day(0));
    expect(m?.hrvMetric).toBe("sdnn");
    expect(m?.readiness).not.toBeNull();
    // ln(70)=4.25 — the SDNN baseline. An rMSSD baseline would be ~ln(97)=4.57.
    expect(m!.hrvBaselineMean!).toBeGreaterThan(4.1);
    expect(m!.hrvBaselineMean!).toBeLessThan(4.4);
  });

  it("prefers rMSSD and its own baseline when both are present", async () => {
    const history = Array.from({ length: 20 }, (_, i) => ({
      date: day(20 - i),
      hrvMs: 95 + (i % 5),
      hrvSdnnMs: 68 + (i % 5),
    }));
    await seed([...history, { date: day(0), hrvMs: 152, hrvSdnnMs: 91 }]);

    await computeDailyMetrics(USER, day(0));

    const m = await metricFor(day(0));
    expect(m?.hrvMetric).toBe("rmssd");
    // ln(97)=4.57 — the rMSSD baseline, not SDNN's ~4.25.
    expect(m!.hrvBaselineMean!).toBeGreaterThan(4.45);
  });

  it("flips the day to rMSSD when it arrives late and the day is recomputed", async () => {
    const history = Array.from({ length: 20 }, (_, i) => ({
      date: day(20 - i),
      hrvMs: 95 + (i % 5),
      hrvSdnnMs: 68 + (i % 5),
    }));
    await seed([...history, { date: day(0), hrvSdnnMs: 91 }]);

    await computeDailyMetrics(USER, day(0));
    const before = await metricFor(day(0));
    expect(before?.hrvMetric).toBe("sdnn");

    // The Zepp pull lands the next morning. 70 is well BELOW the rMSSD
    // baseline (95-99), where the SDNN reading of 91 was well ABOVE its own
    // (68-72). The two metrics must therefore push readiness in opposite
    // directions — a fixture where both merely sit high would let each max
    // the HRV component out at 100 and leave the score identical, proving
    // nothing about whether the day was actually re-resolved.
    await db
      .update(schema.wellnessDaily)
      .set({ hrvMs: 70 })
      .where(
        and(
          eq(schema.wellnessDaily.userId, USER),
          eq(schema.wellnessDaily.date, day(0))
        )
      );
    await computeDailyMetrics(USER, day(0));

    const after = await metricFor(day(0));
    expect(after?.hrvMetric).toBe("rmssd");
    expect(after!.readiness!).toBeLessThan(before!.readiness!);
    // And the stored baseline moved to rMSSD's: ln(97)=4.57, not ln(70)=4.25.
    expect(after!.hrvBaselineMean!).toBeGreaterThan(4.45);
  });

  it("leaves hrvMetric null when neither baseline is calibrated", async () => {
    const short = Array.from({ length: MIN_BASELINE_DAYS - 5 }, (_, i) => ({
      date: day(10 - i),
      hrvMs: 95 + (i % 5),
    }));
    await seed([...short, { date: day(0), hrvMs: 152 }]);

    await computeDailyMetrics(USER, day(0));

    const m = await metricFor(day(0));
    expect(m?.hrvMetric).toBeNull();
  });
});
