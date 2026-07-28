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
      { workouts: [{ durationMins: 60 }] },
      { workouts: [] },
      { workouts: [{ durationMins: 45 }] },
    ];
    expect(plannedWeekVolumeS(days)).toBe(105 * 60);
  });

  it("counts both sessions on a two-session day", () => {
    const days = [
      { workouts: [{ durationMins: 45 }, { durationMins: 60 }] },
      { workouts: [] },
    ];
    expect(plannedWeekVolumeS(days)).toBe(105 * 60);
  });

  it("a week with no planned workouts has no volume target", () => {
    expect(plannedWeekVolumeS([{ workouts: [] }, { workouts: [] }])).toBeNull();
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
    return { provider: "strava", startDate: d, durationS, loadValue };
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

describe("trailingWeeklyAverages de-duplication", () => {
  const day = (n: number) => new Date(2026, 6, n, 18, 33);

  it("counts a ride synced by two providers once", () => {
    const both = [];
    // Six distinct days clears MIN_FALLBACK_ACTIVITY_DAYS.
    for (let i = 1; i <= 6; i++) {
      both.push({
        provider: "intervals_icu",
        startDate: day(i),
        durationS: 7200,
        loadValue: 100,
      });
      both.push({
        provider: "strava",
        startDate: day(i),
        durationS: 7200,
        loadValue: 100,
      });
    }
    const single = both.filter((a) => a.provider === "intervals_icu");

    const dup = trailingWeeklyAverages(both, day(7));
    const clean = trailingWeeklyAverages(single, day(7));

    expect(dup.volumeS).toBe(clean.volumeS);
    expect(dup.load).toBe(clean.load);
  });

  it("still counts two genuinely separate rides on one day", () => {
    const rides = [];
    for (let i = 1; i <= 6; i++) {
      rides.push({
        provider: "strava",
        startDate: new Date(2026, 6, i, 8, 0),
        durationS: 3600,
        loadValue: 50,
      });
      rides.push({
        provider: "strava",
        startDate: new Date(2026, 6, i, 18, 0),
        durationS: 3600,
        loadValue: 50,
      });
    }
    const r = trailingWeeklyAverages(rides, day(7));
    const half = trailingWeeklyAverages(
      rides.filter((_, i) => i % 2 === 0),
      day(7)
    );
    expect(r.volumeS!).toBeGreaterThan(half.volumeS!);
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
