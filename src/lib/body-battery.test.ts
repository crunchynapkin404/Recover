import { describe, expect, it } from "vitest";
import {
  computeBodyBattery,
  typicalBedMinutes,
  AWAKE_DRAIN_TOTAL,
  type BodyBatteryInput,
} from "./body-battery";

/** A full day, waking 07:00–23:00, sampled to midnight. */
const base: BodyBatteryInput = {
  readiness: 100,
  wakeMinutes: 420,
  bedMinutes: 1380,
  activities: [],
  nowMinutes: 1440,
};

describe("body battery (hand-computed fixtures)", () => {
  it("returns null — never a default charge — when readiness is null", () => {
    const r = computeBodyBattery({ ...base, readiness: null });
    expect(r.current).toBeNull();
    expect(r.points).toEqual([]);
  });

  it("drains exactly AWAKE_DRAIN_TOTAL across a full day with no training", () => {
    const r = computeBodyBattery(base);
    expect(r.current).toBe(100 - AWAKE_DRAIN_TOTAL); // 75
  });

  it("charges nothing before the athlete wakes", () => {
    const r = computeBodyBattery({ ...base, nowMinutes: 420 });
    expect(r.current).toBe(100);
  });

  it("costs 35 points for a 100-load session (DRAIN_PER_LOAD)", () => {
    const r = computeBodyBattery({
      ...base,
      activities: [{ startMinutes: 600, durationMin: 60, load: 100 }],
    });
    // 100 − 25 awake − 35 activity
    expect(r.current).toBe(40);
  });

  it("clamps at 0 and never goes negative", () => {
    const r = computeBodyBattery({
      ...base,
      readiness: 50,
      activities: [{ startMinutes: 600, durationMin: 60, load: 300 }],
    });
    expect(r.current).toBe(0);
    expect(Math.min(...r.points.map((p) => p.charge))).toBe(0);
  });

  it("never recovers during the day (monotonically non-increasing)", () => {
    const r = computeBodyBattery({
      ...base,
      activities: [
        { startMinutes: 480, durationMin: 60, load: 40 },
        { startMinutes: 1020, durationMin: 90, load: 60 },
      ],
    });
    const charges = r.points.map((p) => p.charge);
    for (let i = 1; i < charges.length; i++) {
      expect(charges[i]).toBeLessThanOrEqual(charges[i - 1]);
    }
  });

  it("clips the curve at nowMinutes", () => {
    const r = computeBodyBattery({ ...base, nowMinutes: 600 });
    expect(r.points.at(-1)?.minutes).toBe(600);
    expect(r.points.every((p) => p.minutes <= 600)).toBe(true);
  });

  it("ignores an activity that has not started yet", () => {
    const withFuture = computeBodyBattery({
      ...base,
      nowMinutes: 600,
      activities: [{ startMinutes: 1020, durationMin: 60, load: 100 }],
    });
    const withNone = computeBodyBattery({ ...base, nowMinutes: 600 });
    expect(withFuture.current).toBe(withNone.current);
  });
});

describe("typicalBedMinutes (schedule, not a debt recommendation)", () => {
  it("derives 23:00 from a 07:00 wake and an 8h need", () => {
    expect(typicalBedMinutes(420, 28800)).toBe(1380); // 23:00
  });

  it("derives 21:00 from a 05:00 wake and an 8h need", () => {
    expect(typicalBedMinutes(300, 28800)).toBe(1260); // 21:00
  });

  it("wraps across midnight when wake minus need goes negative", () => {
    // 01:00 wake, 8h need: 60 - 480 = -420 -> wraps to 17:00 the previous day.
    expect(typicalBedMinutes(60, 28800)).toBe(1020); // 17:00
  });

  it("lands exactly on midnight rather than 1440 when it divides evenly", () => {
    // 08:00 wake, 8h need: 480 - 480 = 0.
    expect(typicalBedMinutes(480, 28800)).toBe(0); // 00:00
  });

  it("needs no wrap when wake minus need stays within the day", () => {
    // 23:00 wake, 1h need: 1380 - 60 = 1320.
    expect(typicalBedMinutes(1380, 3600)).toBe(1320); // 22:00
  });
});
