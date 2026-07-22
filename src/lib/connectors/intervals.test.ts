import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ConnectorError,
  fetchActivities,
  fetchActivityIntervals,
  fetchActivityStreams,
  fetchAthletePaceCurves,
  fetchAthletePowerCurves,
  fetchBestEfforts,
  fetchDailyWellness,
  fetchPlannedWorkouts,
  validateKey,
} from "./intervals";

function mockFetch(status: number, body: unknown) {
  const fn = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

const params = {
  apiKey: "k",
  athleteId: "i123",
  startDate: new Date(2026, 0, 5, 0, 30), // local time, 00:30
  endDate: new Date(2026, 0, 12, 23, 30),
};

afterEach(() => vi.unstubAllGlobals());

describe("intervals.icu connector (ported — Principle-1 validation)", () => {
  it("validateKey returns the athlete and sends Basic auth", async () => {
    const fn = mockFetch(200, { id: 42, name: "Bart" });
    await expect(validateKey("secret")).resolves.toEqual({
      id: "42",
      name: "Bart",
    });
    const headers = fn.mock.calls[0][1].headers as Record<string, string>;
    expect(headers.Authorization).toBe(
      `Basic ${Buffer.from("API_KEY:secret").toString("base64")}`
    );
  });

  it("maps 401/403 to auth_expired and 429 to rate_limited", async () => {
    mockFetch(401, {});
    await expect(validateKey("bad")).rejects.toMatchObject({
      code: "auth_expired",
    });
    mockFetch(429, {});
    await expect(fetchDailyWellness(params)).rejects.toMatchObject({
      code: "rate_limited",
    });
  });

  it("validateKey rejects an athlete payload without id", async () => {
    mockFetch(200, { name: "nobody" });
    await expect(validateKey("k")).rejects.toBeInstanceOf(ConnectorError);
  });

  // Defect pinned 2026-07-14: ymd() used toISOString() (UTC), shifting the
  // window a day for servers away from UTC. Must use LOCAL date parts.
  it("builds the date window from local dates, not UTC", async () => {
    const fn = mockFetch(200, []);
    await fetchDailyWellness(params);
    const url = fn.mock.calls[0][0] as string;
    expect(url).toContain("oldest=2026-01-05");
    expect(url).toContain("newest=2026-01-12");
  });

  it("parses wellness fields incl. nested sportInfo eftp", async () => {
    mockFetch(200, [
      {
        id: "2026-01-10",
        hrv: 62.5,
        restingHR: 44,
        sleepSecs: 27000,
        sleepScore: 81,
        ctl: 55.2,
        atl: 60.1,
        weight: 71.4,
        sportInfo: [{ eftp: 265 }],
      },
    ]);
    const [day] = await fetchDailyWellness(params);
    expect(day).toMatchObject({
      date: "2026-01-10",
      hrv: 62.5,
      restingHr: 44,
      sleepSecs: 27000,
      sleepScore: 81,
      ctl: 55.2,
      atl: 60.1,
      eftp: 265,
      weight: 71.4,
    });
  });

  it("parses vo2max, rampRate, and sportInfo pMax/wPrime", async () => {
    mockFetch(200, [
      {
        id: "2026-01-10",
        vo2max: 52.3,
        rampRate: 7.46764,
        sportInfo: [{ eftp: 265, pMax: 1509.3558, wPrime: 21088 }],
      },
    ]);
    const [day] = await fetchDailyWellness(params);
    expect(day).toMatchObject({
      vo2max: 52.3,
      rampRate: 7.46764,
      pMax: 1509.3558,
      wPrime: 21088,
    });
  });

  it("defaults vo2max/rampRate/pMax/wPrime to null when absent", async () => {
    mockFetch(200, [{ id: "2026-01-10" }]);
    const [day] = await fetchDailyWellness(params);
    expect(day.vo2max).toBeNull();
    expect(day.rampRate).toBeNull();
    expect(day.pMax).toBeNull();
    expect(day.wPrime).toBeNull();
  });

  // Defect pinned 2026-07-14: rows without an id used to become date:"".
  it("skips wellness rows that have no id", async () => {
    mockFetch(200, [{ hrv: 50 }, { id: "2026-01-11", hrv: 60 }]);
    const days = await fetchDailyWellness(params);
    expect(days).toHaveLength(1);
    expect(days[0].date).toBe("2026-01-11");
  });

  it("treats non-numeric metric values as null", async () => {
    mockFetch(200, [{ id: "2026-01-10", hrv: "n/a", restingHR: null }]);
    const [day] = await fetchDailyWellness(params);
    expect(day.hrv).toBeNull();
    expect(day.restingHr).toBeNull();
  });

  it("parses activities with fallbacks and skips invalid rows", async () => {
    mockFetch(200, [
      {
        id: "i900",
        start_date_local: "2026-01-10T08:00:00",
        type: "Ride",
        name: "Morning ride",
        elapsed_time: 4000, // no moving_time → falls back
        distance: 40000,
        icu_training_load: 85,
        average_heartrate: 140,
        average_watts: 190, // no icu_average_watts → falls back
        total_elevation_gain: 300,
      },
      { id: "i901" }, // no start date → skipped
      { start_date_local: "2026-01-11T08:00:00" }, // no id → skipped
    ]);
    const acts = await fetchActivities(params);
    expect(acts).toHaveLength(1);
    expect(acts[0]).toMatchObject({
      externalId: "i900",
      sport: "Ride",
      durationS: 4000,
      avgPower: 190,
      load: 85,
      elevationM: 300,
    });
  });
});

describe("activity streams + intervals", () => {
  it("fetches and normalizes streams, dropping malformed entries", async () => {
    const fn = mockFetch(200, [
      { type: "heartrate", data: [120, 130, null, 140] },
      { type: "watts", data: [200, "x", 210] },
      { notAType: true },
    ]);
    const out = await fetchActivityStreams({ apiKey: "k", externalId: "a1" });
    expect(out).toEqual([
      { type: "heartrate", data: [120, 130, null, 140] },
      { type: "watts", data: [200, null, 210] },
    ]);
    const url = fn.mock.calls[0][0] as string;
    expect(url).toContain("/activity/a1/streams");
    expect(url).toContain("heartrate");
  });

  it("normalizes intervals to laps", async () => {
    mockFetch(200, {
      icu_intervals: [
        {
          label: "Rep 1",
          elapsed_time: 480,
          distance: 4000,
          average_heartrate: 165,
          average_watts: 250,
        },
        { elapsed_time: 120 },
      ],
    });
    const out = await fetchActivityIntervals({ apiKey: "k", externalId: "a1" });
    expect(out).toEqual([
      {
        index: 1,
        label: "Rep 1",
        durationS: 480,
        distanceM: 4000,
        avgHr: 165,
        avgPower: 250,
      },
      {
        index: 2,
        label: null,
        durationS: 120,
        distanceM: null,
        avgHr: null,
        avgPower: null,
      },
    ]);
  });

  it("maps stream fetch auth errors like the other calls", async () => {
    mockFetch(403, {});
    await expect(
      fetchActivityStreams({ apiKey: "bad", externalId: "a1" })
    ).rejects.toMatchObject({ code: "auth_expired" });
  });
});

describe("v0.4c curve fetchers", () => {
  it("normalizes power curves (flat and list-wrapped payloads)", async () => {
    const body = {
      list: [
        {
          secs: [1, 5, 60, 300, 1200, 3600],
          watts: [905, 748, 421, 342, 311, 288],
          watts_per_kg: [12.9, 10.7, 6.0, 4.9, 4.4, 4.1],
        },
      ],
    };
    const fn = mockFetch(200, body);
    const curve = await fetchAthletePowerCurves({
      apiKey: "k",
      athleteId: "i1",
      days: 90,
    });
    expect(curve).toEqual({
      secs: [1, 5, 60, 300, 1200, 3600],
      watts: [905, 748, 421, 342, 311, 288],
      wattsPerKg: [12.9, 10.7, 6.0, 4.9, 4.4, 4.1],
    });
    expect(String(fn.mock.calls[0][0])).toContain(
      "/athlete/i1/power-curves?days=90"
    );

    // Flat payload (no list wrapper), no per-kg series.
    mockFetch(200, { secs: [60], watts: [400] });
    await expect(
      fetchAthletePowerCurves({ apiKey: "k", athleteId: "i1", days: 30 })
    ).resolves.toEqual({ secs: [60], watts: [400], wattsPerKg: null });
  });

  it("drops malformed power points and rejects shape mismatch", async () => {
    // secs/watts length mismatch → ConnectorError("unknown")
    mockFetch(200, { secs: [1, 5], watts: [900] });
    await expect(
      fetchAthletePowerCurves({ apiKey: "k", athleteId: "i1", days: 90 })
    ).rejects.toMatchObject({ code: "unknown" });
  });

  it("normalizes pace curves to secs-per-km", async () => {
    const fn = mockFetch(200, {
      list: [{ distances: [400, 1000, 5000], secs: [72, 210, 1260] }],
    });
    const curve = await fetchAthletePaceCurves({
      apiKey: "k",
      athleteId: "i1",
      days: 90,
    });
    expect(curve.distanceM).toEqual([400, 1000, 5000]);
    expect(curve.secsPerKm.map((s) => +s.toFixed(1))).toEqual([
      180.0, 210.0, 252.0,
    ]);
    expect(String(fn.mock.calls[0][0])).toContain(
      "/athlete/i1/pace-curves?days=90&type=Run"
    );
  });

  it("normalizes best efforts and skips rows without a numeric value", async () => {
    mockFetch(200, [
      {
        name: "20m power",
        type: "Ride",
        value: 342,
        unit: "w",
        activity_id: "i778",
        start_date_local: "2026-07-01T09:00:00",
      },
      { name: "broken row", type: "Run" }, // no value → skipped
    ]);
    const efforts = await fetchBestEfforts({
      apiKey: "k",
      athleteId: "i1",
      days: 90,
    });
    expect(efforts).toEqual([
      {
        label: "20m power",
        sport: "Ride",
        value: 342,
        unit: "w",
        activityExternalId: "i778",
        date: "2026-07-01",
      },
    ]);
  });

  it("maps auth/rate-limit errors like every other endpoint", async () => {
    mockFetch(401, {});
    await expect(
      fetchAthletePowerCurves({ apiKey: "bad", athleteId: "i1", days: 90 })
    ).rejects.toMatchObject({ code: "auth_expired" });
    mockFetch(429, {});
    await expect(
      fetchBestEfforts({ apiKey: "k", athleteId: "i1", days: 90 })
    ).rejects.toMatchObject({ code: "rate_limited" });
  });
});

describe("fetchPlannedWorkouts", () => {
  it("parses planned workout events", async () => {
    const fn = mockFetch(200, [
      {
        id: 42,
        name: "Tempo ride",
        type: "Ride",
        start_date_local: "2026-07-20T08:00:00",
        moving_time: 5400,
        icu_training_load: 85,
        description: "3x20 min Z3",
      },
      {
        id: 43,
        name: "Easy run",
        type: "Run",
        start_date_local: "2026-07-21T07:00:00",
        moving_time: 2700,
        icu_training_load: 40,
        description: null,
      },
    ]);
    const result = await fetchPlannedWorkouts({
      apiKey: "test",
      athleteId: "i1",
      startDate: "2026-07-20",
      endDate: "2026-07-27",
    });
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      id: "42",
      name: "Tempo ride",
      sport: "Ride",
      date: "2026-07-20",
      durationMins: 90,
      targetLoad: 85,
      description: "3x20 min Z3",
    });
    const url = fn.mock.calls[0][0] as string;
    expect(url).toContain("/athlete/i1/events");
    expect(url).toContain("category=WORKOUT");
  });

  it("returns empty array on non-array response", async () => {
    mockFetch(200, {});
    const result = await fetchPlannedWorkouts({
      apiKey: "test",
      athleteId: "i1",
      startDate: "2026-07-20",
      endDate: "2026-07-27",
    });
    expect(result).toEqual([]);
  });
});
