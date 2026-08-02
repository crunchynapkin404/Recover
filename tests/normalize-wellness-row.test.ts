import { describe, it, expect } from "vitest";
import { normalizeWellnessRow } from "@/lib/connectors/intervals";

// Both fixtures are real shapes observed on the live account 2026-08-02.
const ROW_2026: Record<string, unknown> = {
  id: "2026-07-31",
  hrv: 87,
  restingHR: 48,
  sleepSecs: 19664,
  sleepScore: 62,
  ctl: 80.5,
  atl: 81.3,
  rampRate: -2.4,
  vo2max: 64,
  weight: 77.4,
  spO2: 96.675156,
  respiration: 16.406073,
  bodyFat: 15.7,
  avgSleepingHR: 52,
  hrvSDNN: 68,
  readiness: 71,
  hydrationVolume: 3.937,
  steps: 5694,
  sleepQuality: 3,
  DeepSleep: 3597,
  REMSleep: 4437,
  LightSleep: 11630,
  sportInfo: [{ eftp: 315, pMax: 1425.5, wPrime: 26438 }],
};

// A 2021 row: intervals.icu had CTL/ATL and a sleep duration, nothing else.
const ROW_2021: Record<string, unknown> = {
  id: "2021-06-15",
  sleepSecs: 41220,
  ctl: 5.5,
  atl: 2.8,
  rampRate: -1.0,
  sportInfo: [{}],
};

describe("normalizeWellnessRow", () => {
  it("maps every field of a modern row", () => {
    expect(normalizeWellnessRow(ROW_2026)).toMatchObject({
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
    });
  });

  it("keeps the original payload on `raw`", () => {
    expect(normalizeWellnessRow(ROW_2026)?.raw).toBe(ROW_2026);
  });

  it("nulls absent fields on a sparse historical row rather than inventing them", () => {
    const day = normalizeWellnessRow(ROW_2021);
    expect(day).toMatchObject({
      date: "2021-06-15",
      sleepSecs: 41220,
      ctl: 5.5,
      atl: 2.8,
    });
    expect(day?.hrv).toBeNull();
    expect(day?.restingHr).toBeNull();
    expect(day?.spO2).toBeNull();
    expect(day?.steps).toBeNull();
    expect(day?.eftp).toBeNull();
    expect(day?.sleepDeepSecs).toBeNull();
  });

  it("rejects a row without a usable date id", () => {
    expect(normalizeWellnessRow({ hrv: 50 })).toBeNull();
    expect(normalizeWellnessRow({ id: "", hrv: 50 })).toBeNull();
    expect(normalizeWellnessRow({ id: 20260731, hrv: 50 })).toBeNull();
  });
});
