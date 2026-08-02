import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { remapStoredWellness } from "@/lib/sync/intervals-backfill";

const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

// MUST stay skipIf-guarded: CI has no DATABASE_URL, and an unguarded DB test
// crashes the whole `checks` job instead of skipping (how PR #20 went red).
describe.skipIf(!hasDb)("remapStoredWellness (v0.36 Phase A)", () => {
  const userId = "test-wellness-remap-user";

  // A payload exactly as the daily sync stored it: rich raw, and the columns
  // that v0.33 later added to the mapping left empty.
  const raw = (date: string): Record<string, unknown> => ({
    id: date,
    hrv: 87,
    restingHR: 48,
    sleepSecs: 19664,
    steps: 5694,
    spO2: 96.675156,
    vo2max: 64,
    bodyFat: 15.7,
    avgSleepingHR: 52,
    sleepQuality: 3,
    hydrationVolume: 3.937,
    ctl: 80.5,
  });

  beforeEach(async () => {
    await db.delete(schema.users).where(eq(schema.users.id, userId));
    await db.insert(schema.users).values({
      id: userId,
      name: "Remap Test",
      email: `${userId}@test.local`,
    });
  });

  afterEach(async () => {
    await db.delete(schema.users).where(eq(schema.users.id, userId));
  });

  async function row(date: string) {
    return db.query.wellnessDaily.findFirst({
      where: and(
        eq(schema.wellnessDaily.userId, userId),
        eq(schema.wellnessDaily.date, date)
      ),
    });
  }

  it("fills columns that lag their stored raw payload", async () => {
    await db.insert(schema.wellnessDaily).values({
      userId,
      date: "2026-01-15",
      hrvMs: 87,
      restingHr: 48,
      sleepSecs: 19664,
      raw: raw("2026-01-15"),
      fieldSources: {
        hrvMs: "intervals_icu",
        restingHr: "intervals_icu",
        sleepSecs: "intervals_icu",
      },
    });

    const result = await remapStoredWellness(userId);

    expect(result.remapped).toBe(1);
    expect(result.earliestDate).toBe("2026-01-15");

    const after = await row("2026-01-15");
    expect(after?.steps).toBe(5694);
    expect(after?.bloodOxygenPct).toBeCloseTo(96.675156, 4);
    expect(after?.vo2max).toBe(64);
    expect(after?.bodyFatPct).toBeCloseTo(15.7, 4);
    expect(after?.sleepingHr).toBe(52);
    expect(after?.sleepQuality).toBe(3);
    expect(after?.hydrationL).toBeCloseTo(3.937, 4);
    // Untouched, because they were already correct.
    expect(after?.hrvMs).toBe(87);
  });

  it("never overwrites a field a better-ranked source owns", async () => {
    // apple_health outranks intervals_icu for bloodOxygenPct (PHYSIOLOGY).
    await db.insert(schema.wellnessDaily).values({
      userId,
      date: "2026-01-16",
      bloodOxygenPct: 99,
      raw: raw("2026-01-16"),
      fieldSources: { bloodOxygenPct: "apple_health" },
    });

    await remapStoredWellness(userId);

    const after = await row("2026-01-16");
    expect(after?.bloodOxygenPct).toBe(99);
    expect((after?.fieldSources ?? {}).bloodOxygenPct).toBe("apple_health");
    // Fields nobody owned still get filled.
    expect(after?.steps).toBe(5694);
  });

  it("skips a raw payload that is not an intervals.icu wellness row", async () => {
    // Apple Health last wrote this row's raw; its shape has no date `id`.
    await db.insert(schema.wellnessDaily).values({
      userId,
      date: "2026-01-17",
      raw: { source: "apple_health", steps: 111 },
      fieldSources: {},
    });

    const result = await remapStoredWellness(userId);

    expect(result.remapped).toBe(0);
    expect((await row("2026-01-17"))?.steps).toBeNull();
  });

  it("reports the earliest CHANGED date, not the earliest row", async () => {
    await db.insert(schema.wellnessDaily).values([
      {
        userId,
        date: "2026-01-10",
        raw: { source: "apple_health" }, // unchangeable
        fieldSources: {},
      },
      {
        userId,
        date: "2026-01-12",
        raw: raw("2026-01-12"),
        fieldSources: {},
      },
    ]);

    const result = await remapStoredWellness(userId);

    expect(result.earliestDate).toBe("2026-01-12");
  });
});
