import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ConnectorError,
  fetchActivities,
  fetchActivityIntervals,
  fetchActivityStreams,
  fetchDailyWellness,
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
