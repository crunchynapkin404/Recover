import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import {
  runIntervalsBackfill,
  MAX_BACKFILL_YEARS,
} from "@/lib/sync/intervals-backfill";
import type { WellnessFetcher } from "@/lib/sync/wellness-refresh";
import type { IntervalsWellnessDay } from "@/lib/connectors/intervals";

const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

function day(date: string): IntervalsWellnessDay {
  return {
    date,
    hrv: 60,
    restingHr: 50,
    sleepSecs: 27000,
    sleepScore: null,
    ctl: 20,
    atl: 18,
    eftp: null,
    vo2max: null,
    rampRate: null,
    pMax: null,
    wPrime: null,
    weight: 75,
    spO2: null,
    respiration: null,
    bodyFat: null,
    sleepingHr: null,
    hrvSdnn: null,
    readiness: null,
    hydrationL: null,
    steps: null,
    sleepQuality: null,
    sleepDeepSecs: null,
    sleepRemSecs: null,
    sleepLightSecs: null,
    raw: { id: date, hrv: 60, restingHR: 50, sleepSecs: 27000, weight: 75 },
  };
}

/** A day carrying only intervals.icu's own training-load model outputs —
 *  exactly what the synthesized filler intervals.icu backfills for every
 *  calendar day back to account creation looks like (CTL exactly 0.0 was
 *  the observed real-world shape). Everything `hasRealSignal` checks is
 *  null. */
function loadOnlyDay(date: string): IntervalsWellnessDay {
  return {
    date,
    hrv: null,
    restingHr: null,
    sleepSecs: null,
    sleepScore: null,
    ctl: 0,
    atl: 0,
    eftp: null,
    vo2max: null,
    rampRate: null,
    pMax: null,
    wPrime: null,
    weight: null,
    spO2: null,
    respiration: null,
    bodyFat: null,
    sleepingHr: null,
    hrvSdnn: null,
    readiness: null,
    hydrationL: null,
    steps: null,
    sleepQuality: null,
    sleepDeepSecs: null,
    sleepRemSecs: null,
    sleepLightSecs: null,
    raw: { id: date, ctl: 0, atl: 0 },
  };
}

/** Fetcher driven by an explicit year -> response map, for tests that need
 *  to control exactly what each requested chunk returns. */
function mappedFetcher(responses: Record<number, IntervalsWellnessDay[]>) {
  const calls: Array<{ start: string; end: string }> = [];
  const fetcher: WellnessFetcher = async ({ startDate, endDate }) => {
    const start = startDate.toISOString().slice(0, 10);
    const end = endDate.toISOString().slice(0, 10);
    calls.push({ start, end });
    const year = Number(start.slice(0, 4));
    return responses[year] ?? [];
  };
  return { calls, fetcher };
}

/** Always returns one real-signal day, for whatever year is requested —
 *  never stops on its own, so the walk can only end by hitting
 *  MAX_BACKFILL_YEARS. */
function everyYearHasSignalFetcher() {
  const calls: Array<{ start: string; end: string }> = [];
  const fetcher: WellnessFetcher = async ({ startDate, endDate }) => {
    const start = startDate.toISOString().slice(0, 10);
    const end = endDate.toISOString().slice(0, 10);
    calls.push({ start, end });
    const year = Number(start.slice(0, 4));
    return [day(`${year}-03-01`)];
  };
  return { calls, fetcher };
}

// MUST stay skipIf-guarded: CI has no DATABASE_URL, and an unguarded DB test
// crashes the whole `checks` job instead of skipping (how PR #20 went red).
describe.skipIf(!hasDb)("runIntervalsBackfill (v0.36)", () => {
  const userId = "test-wellness-backfill-user";
  const lastSyncAt = new Date("2026-08-01T05:00:00.000Z");

  beforeEach(async () => {
    await db.delete(schema.users).where(eq(schema.users.id, userId));
    await db.insert(schema.users).values({
      id: userId,
      name: "Backfill Test",
      email: `${userId}@test.local`,
    });
    await db.insert(schema.connections).values({
      userId,
      provider: "intervals_icu",
      encryptedAccessToken: encrypt("test-api-key"),
      externalAthleteId: "i1",
      status: "active",
      lastSyncAt,
    });
    // One local day, so the backfill boundary is 2025-06-09.
    await db.insert(schema.wellnessDaily).values({
      userId,
      date: "2025-06-10",
      hrvMs: 61,
      raw: { id: "2025-06-10", hrv: 61 },
      fieldSources: { hrvMs: "intervals_icu" },
    });
  });

  afterEach(async () => {
    await db.delete(schema.users).where(eq(schema.users.id, userId));
  });

  /** Records every window it was asked for; serves days for `years`. */
  function recordingFetcher(years: number[]) {
    const calls: Array<{ start: string; end: string }> = [];
    const fetcher: WellnessFetcher = async ({ startDate, endDate }) => {
      const start = startDate.toISOString().slice(0, 10);
      const end = endDate.toISOString().slice(0, 10);
      calls.push({ start, end });
      const year = Number(start.slice(0, 4));
      return years.includes(year) ? [day(`${year}-03-01`)] : [];
    };
    return { calls, fetcher };
  }

  it("walks back one calendar year per request from the oldest local day", async () => {
    const { calls, fetcher } = recordingFetcher([2025, 2024, 2023]);

    const result = await runIntervalsBackfill(userId, { fetcher, delayMs: 0 });

    // First chunk is capped at the day before the oldest local row.
    expect(calls[0]).toEqual({ start: "2025-01-01", end: "2025-06-09" });
    expect(calls[1]).toEqual({ start: "2024-01-01", end: "2024-12-31" });
    expect(calls[2]).toEqual({ start: "2023-01-01", end: "2023-12-31" });
    expect(result.fetched).toBe(3);
    expect(result.earliestDate).toBe("2023-03-01");
  });

  it("stops at the first empty year instead of walking forever", async () => {
    const { calls, fetcher } = recordingFetcher([2025, 2024]);

    await runIntervalsBackfill(userId, { fetcher, delayMs: 0 });

    // 2025, 2024, then 2023 comes back empty and ends the walk.
    expect(calls).toHaveLength(3);
    expect(calls[2].start).toBe("2023-01-01");
  });

  it("writes the fetched days through the merge", async () => {
    const { fetcher } = recordingFetcher([2025]);

    await runIntervalsBackfill(userId, { fetcher, delayMs: 0 });

    const row = await db.query.wellnessDaily.findFirst({
      where: and(
        eq(schema.wellnessDaily.userId, userId),
        eq(schema.wellnessDaily.date, "2025-03-01")
      ),
    });
    expect(row?.hrvMs).toBe(60);
    expect(row?.weightKg).toBe(75);
    expect((row?.fieldSources ?? {}).hrvMs).toBe("intervals_icu");
  });

  it("leaves the incremental sync cursor untouched", async () => {
    const { fetcher } = recordingFetcher([2025, 2024]);

    await runIntervalsBackfill(userId, { fetcher, delayMs: 0 });

    const conn = await db.query.connections.findFirst({
      where: and(
        eq(schema.connections.userId, userId),
        eq(schema.connections.provider, "intervals_icu")
      ),
    });
    expect(conn?.lastSyncAt?.toISOString()).toBe(lastSyncAt.toISOString());
  });

  it("heartbeats at least once per chunk", async () => {
    const { fetcher } = recordingFetcher([2025, 2024]);
    let beats = 0;

    await runIntervalsBackfill(userId, {
      fetcher,
      delayMs: 0,
      onProgress: async () => {
        beats++;
      },
    });

    // One after Phase A, one per non-empty chunk.
    expect(beats).toBeGreaterThanOrEqual(3);
  });

  // v0.36 final-review fix: intervals.icu synthesizes a wellness row for
  // every calendar day back to account creation, carrying only CTL/ATL
  // decay — so the "stop at an empty chunk" rule above never fires on real
  // data. A load-only chunk must be discarded (not written) and end the walk.
  it("discards and stops at a chunk with no real signal, even the first (partial) one", async () => {
    const { calls, fetcher } = mappedFetcher({
      // 2025 is the first (partial-year) chunk — the rule must apply there too.
      2025: [loadOnlyDay("2025-03-01")],
      // Never reached if the walk correctly stops at 2025.
      2024: [day("2024-03-01")],
    });

    const result = await runIntervalsBackfill(userId, { fetcher, delayMs: 0 });

    expect(calls).toHaveLength(1);
    expect(result.fetched).toBe(0);
    expect(result.truncated).toBe(false); // a real stop condition, not the cap

    const row = await db.query.wellnessDaily.findFirst({
      where: and(
        eq(schema.wellnessDaily.userId, userId),
        eq(schema.wellnessDaily.date, "2025-03-01")
      ),
    });
    expect(row).toBeUndefined();
  });

  it("writes a chunk in full, filler included, when it holds any real measurement — and keeps walking", async () => {
    const { calls, fetcher } = mappedFetcher({
      2025: [loadOnlyDay("2025-02-01"), day("2025-03-01")],
      2024: [], // empty stops the walk after this
    });

    const result = await runIntervalsBackfill(userId, { fetcher, delayMs: 0 });

    expect(calls).toHaveLength(2); // 2025 written & continued, 2024 empty & stopped
    expect(result.fetched).toBe(2);
    expect(result.truncated).toBe(false);

    const filler = await db.query.wellnessDaily.findFirst({
      where: and(
        eq(schema.wellnessDaily.userId, userId),
        eq(schema.wellnessDaily.date, "2025-02-01")
      ),
    });
    expect(filler).toBeDefined();
    expect(filler?.ctl).toBe(0);

    const signal = await db.query.wellnessDaily.findFirst({
      where: and(
        eq(schema.wellnessDaily.userId, userId),
        eq(schema.wellnessDaily.date, "2025-03-01")
      ),
    });
    expect(signal?.hrvMs).toBe(60);
  });

  it("marks the result truncated when the walk exhausts MAX_BACKFILL_YEARS instead of stopping", async () => {
    const { calls, fetcher } = everyYearHasSignalFetcher();

    const result = await runIntervalsBackfill(userId, { fetcher, delayMs: 0 });

    expect(calls).toHaveLength(MAX_BACKFILL_YEARS);
    expect(result.truncated).toBe(true);
  });

  it("refuses to run without an intervals.icu connection", async () => {
    await db
      .delete(schema.connections)
      .where(eq(schema.connections.userId, userId));

    await expect(
      runIntervalsBackfill(userId, {
        fetcher: recordingFetcher([]).fetcher,
        delayMs: 0,
      })
    ).rejects.toThrow(/no intervals\.icu connection/i);
  });
});
