import { describe, expect, it } from "vitest";
import {
  plannedWeekVolumeS,
  ringFraction,
  trailingWeeklyAverages,
  MIN_FALLBACK_ACTIVITY_DAYS,
} from "./weekly-targets";

describe("plannedWeekVolumeS", () => {
  it("sums planned workout minutes into seconds", () => {
    const days = [
      { workout: { durationMins: 60 } },
      { workout: null },
      { workout: { durationMins: 45 } },
    ];
    expect(plannedWeekVolumeS(days)).toBe(105 * 60);
  });

  it("a week with no planned workouts has no volume target", () => {
    expect(
      plannedWeekVolumeS([{ workout: null }, { workout: null }])
    ).toBeNull();
  });
});

describe("trailingWeeklyAverages", () => {
  const today = new Date("2026-07-18T12:00:00");

  function activityOnDay(
    daysAgo: number,
    durationS: number,
    loadValue: number
  ) {
    const d = new Date(today);
    d.setDate(d.getDate() - daysAgo);
    return { startDate: d, durationS, loadValue };
  }

  it("averages a month of training into weekly targets", () => {
    // 8 sessions on 8 distinct days: 8×3600s volume, 8×50 load over 4 weeks
    const acts = Array.from({ length: 8 }, (_, i) =>
      activityOnDay(i * 3 + 1, 3600, 50)
    );
    const out = trailingWeeklyAverages(acts, today);
    expect(out.volumeS).toBe(7200);
    expect(out.load).toBe(100);
  });

  it("sparse history yields no targets", () => {
    const acts = Array.from(
      { length: MIN_FALLBACK_ACTIVITY_DAYS - 1 },
      (_, i) => activityOnDay(i * 2 + 1, 3600, 50)
    );
    expect(trailingWeeklyAverages(acts, today)).toEqual({
      volumeS: null,
      load: null,
    });
  });

  it("activities outside the 28-day window are ignored", () => {
    const acts = Array.from({ length: 10 }, (_, i) =>
      activityOnDay(35 + i, 3600, 50)
    );
    expect(trailingWeeklyAverages(acts, today)).toEqual({
      volumeS: null,
      load: null,
    });
  });

  it("multiple activities on one day count as one day for the gate", () => {
    const acts = Array.from({ length: 12 }, (_, i) =>
      activityOnDay(1 + (i % 3), 3600, 50)
    );
    // 12 activities but only 3 distinct days → below the gate
    expect(trailingWeeklyAverages(acts, today)).toEqual({
      volumeS: null,
      load: null,
    });
  });
});

describe("ringFraction", () => {
  it("caps at 1 and handles missing targets", () => {
    expect(ringFraction(3600, 7200)).toBe(0.5);
    expect(ringFraction(9000, 7200)).toBe(1);
    expect(ringFraction(3600, null)).toBeNull();
    expect(ringFraction(3600, 0)).toBeNull();
  });
});
