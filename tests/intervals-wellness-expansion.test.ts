import { describe, it, expect } from "vitest";
import { and, eq } from "drizzle-orm";
import { applyWellnessPatch } from "@/lib/wellness-merge";
import { wellnessDayToPatch } from "@/lib/sync/intervals-sync";
import type { IntervalsWellnessDay } from "@/lib/connectors/intervals";
import { db, schema } from "@/lib/db";

// The producer, tested without a DB. A consumer-only test (below) passes even
// if the sync path forwards nothing at all — this is the one that would fail.
describe("wellnessDayToPatch", () => {
  const day: IntervalsWellnessDay = {
    date: "2026-07-31",
    hrv: 87,
    restingHr: 48,
    sleepSecs: 19664,
    sleepScore: 62,
    ctl: 80.5,
    atl: 81.3,
    eftp: 315,
    vo2max: 64,
    rampRate: -2.4,
    pMax: 1425.5,
    wPrime: 26438,
    weight: 77.4,
    spO2: 96.675156,
    respiration: 16.406073,
    bodyFat: 15.7,
    sleepingHr: 52,
    hrvSdnn: 68,
    readiness: 71,
    hydrationL: 3.937,
    steps: 5694,
    sleepQuality: 3,
    sleepDeepSecs: 3597,
    sleepRemSecs: 4437,
    sleepLightSecs: 11630,
    raw: {},
  };

  it("forwards every v0.33 field onto the patch", () => {
    expect(wellnessDayToPatch(day)).toMatchObject({
      bloodOxygenPct: 96.675156,
      respiratoryRate: 16.406073,
      bodyFatPct: 15.7,
      sleepDeepSecs: 3597,
      sleepRemSecs: 4437,
      sleepLightSecs: 11630,
      sleepingHr: 52,
      hrvSdnnMs: 68,
      readiness: 71,
      hydrationL: 3.937,
      steps: 5694,
      sleepQuality: 3,
    });
  });

  it("still forwards the pre-existing fields", () => {
    expect(wellnessDayToPatch(day)).toMatchObject({
      hrvMs: 87,
      restingHr: 48,
      sleepSecs: 19664,
      sleepScore: 62,
      ctl: 80.5,
      atl: 81.3,
      eftp: 315,
      vo2max: 64,
      rampRate: -2.4,
      pMax: 1425.5,
      wPrime: 26438,
      weightKg: 77.4,
    });
  });

  it("never invents values intervals.icu cannot supply", () => {
    const patch = wellnessDayToPatch(day);
    expect(patch.bedStart).toBeUndefined();
    expect(patch.bedEnd).toBeUndefined();
    expect(patch.sleepAwakeSecs).toBeUndefined();
  });
});

const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

// MUST stay skipIf-guarded: CI has no DATABASE_URL, and an unguarded DB test
// crashes the whole `checks` job instead of skipping (how PR #20 went red).
describe.skipIf(!hasDb)("intervals wellness expansion (v0.33)", () => {
  const userId = "test-wellness-expansion-user";
  const date = "2026-07-31";

  it("persists the v0.33 fields with intervals_icu provenance", async () => {
    await db
      .insert(schema.users)
      .values({
        id: userId,
        name: "Wellness Expansion Test",
        email: `${userId}@test.local`,
      })
      .onConflictDoNothing();

    try {
      await applyWellnessPatch(
        userId,
        date,
        {
          sleepSecs: 19664,
          sleepDeepSecs: 3597,
          sleepRemSecs: 4437,
          sleepLightSecs: 11630,
          bloodOxygenPct: 96.675156,
          respiratoryRate: 16.406073,
          bodyFatPct: 15.7,
          sleepingHr: 52,
          hrvSdnnMs: 68,
          readiness: 71,
          hydrationL: 3.937,
          steps: 5694,
          sleepQuality: 3,
        },
        "intervals_icu"
      );

      const row = await db.query.wellnessDaily.findFirst({
        where: and(
          eq(schema.wellnessDaily.userId, userId),
          eq(schema.wellnessDaily.date, date)
        ),
      });

      expect(row?.sleepDeepSecs).toBe(3597);
      expect(row?.sleepRemSecs).toBe(4437);
      expect(row?.sleepLightSecs).toBe(11630);
      expect(row?.bloodOxygenPct).toBeCloseTo(96.675156, 3);
      expect(row?.respiratoryRate).toBeCloseTo(16.406073, 3);
      expect(row?.bodyFatPct).toBeCloseTo(15.7, 3);
      expect(row?.sleepingHr).toBe(52);
      expect(row?.hrvSdnnMs).toBe(68);
      expect(row?.readiness).toBe(71);
      expect(row?.hydrationL).toBeCloseTo(3.937, 3);
      expect(row?.steps).toBe(5694);
      expect(row?.sleepQuality).toBe(3);

      const sources = row?.fieldSources as Record<string, string>;
      expect(sources.steps).toBe("intervals_icu");
      expect(sources.sleepDeepSecs).toBe("intervals_icu");

      // Stages sum to sleepSecs — the invariant observed 4/4 on live data,
      // which is also why sleepAwakeSecs stays null on this route.
      expect(
        (row!.sleepDeepSecs ?? 0) +
          (row!.sleepRemSecs ?? 0) +
          (row!.sleepLightSecs ?? 0)
      ).toBe(row!.sleepSecs);
      expect(row?.sleepAwakeSecs).toBeNull();
    } finally {
      await db
        .delete(schema.wellnessDaily)
        .where(eq(schema.wellnessDaily.userId, userId));
      await db.delete(schema.users).where(eq(schema.users.id, userId));
    }
  });
});
