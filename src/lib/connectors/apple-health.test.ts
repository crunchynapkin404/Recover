import { describe, expect, it } from "vitest";
import { mapAppleHealth } from "./apple-health";

describe("mapAppleHealth", () => {
  it("maps scalar metrics to the day of their timestamp", () => {
    const days = mapAppleHealth({
      data: {
        metrics: [
          {
            name: "heart_rate_variability",
            units: "ms",
            data: [{ date: "2026-07-15 00:00:00 +0000", qty: 62.3 }],
          },
          {
            name: "resting_heart_rate",
            units: "bpm",
            data: [{ date: "2026-07-15 00:00:00 +0000", qty: 48 }],
          },
          {
            name: "respiratory_rate",
            units: "count/min",
            data: [{ date: "2026-07-15 00:00:00 +0000", qty: 14.4 }],
          },
        ],
      },
    });
    const day = days.get("2026-07-15");
    expect(day).toEqual({ hrvMs: 62.3, restingHr: 48, respiratoryRate: 14.4 });
  });

  it("maps staged sleep to the wake date", () => {
    const days = mapAppleHealth({
      data: {
        metrics: [
          {
            name: "sleep_analysis",
            data: [
              {
                sleepStart: "2026-07-14 23:10:00 +0000",
                sleepEnd: "2026-07-15 07:05:00 +0000",
                deep: 1.5,
                rem: 1.5,
                core: 4,
                awake: 0.3,
              },
            ],
          },
        ],
      },
    });
    const day = days.get("2026-07-15")!;
    expect(day.sleepDeepSecs).toBe(5400);
    expect(day.sleepRemSecs).toBe(5400);
    expect(day.sleepLightSecs).toBe(14400);
    expect(day.sleepAwakeSecs).toBe(1080);
    expect(day.sleepSecs).toBe(5400 + 5400 + 14400);
    expect(day.bedStart).toBeInstanceOf(Date);
    expect(day.bedEnd).toBeInstanceOf(Date);
  });

  it("converts pounds to kg and fraction body-fat to percent", () => {
    const days = mapAppleHealth({
      data: {
        metrics: [
          {
            name: "body_mass",
            units: "lb",
            data: [{ date: "2026-07-15 06:00:00 +0000", qty: 154 }],
          },
          {
            name: "body_fat_percentage",
            units: "%",
            data: [{ date: "2026-07-15 06:00:00 +0000", qty: 0.18 }],
          },
        ],
      },
    });
    const day = days.get("2026-07-15")!;
    expect(day.weightKg).toBeCloseTo(69.85, 1);
    expect(day.bodyFatPct).toBeCloseTo(18, 5);
  });

  it("maps blood pressure to systolic/diastolic", () => {
    const days = mapAppleHealth({
      data: {
        metrics: [
          {
            name: "blood_pressure_systolic",
            units: "mmHg",
            data: [{ date: "2026-07-15 08:00:00 +0000", qty: 118 }],
          },
          {
            name: "blood_pressure_diastolic",
            units: "mmHg",
            data: [{ date: "2026-07-15 08:00:00 +0000", qty: 74 }],
          },
        ],
      },
    });
    const day = days.get("2026-07-15")!;
    expect(day.systolic).toBe(118);
    expect(day.diastolic).toBe(74);
  });

  it("ignores unknown metrics and malformed payloads", () => {
    expect(mapAppleHealth({}).size).toBe(0);
    expect(mapAppleHealth({ data: { metrics: "nope" } }).size).toBe(0);
    const days = mapAppleHealth({
      data: {
        metrics: [
          {
            name: "step_count",
            units: "count",
            data: [{ date: "2026-07-15 00:00:00 +0000", qty: 8000 }],
          },
        ],
      },
    });
    expect(days.size).toBe(0);
  });
});
