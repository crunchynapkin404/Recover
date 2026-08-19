import { describe, expect, it } from "vitest";
import {
  activityStats,
  activityMeta,
  type StatSourceActivity,
} from "./activity-stats";

const base: StatSourceActivity = {
  sport: "Ride",
  provider: "intervals_icu",
  startDate: new Date("2026-08-11T09:00:00Z"),
  startDateLocal: new Date("2026-08-11T11:00:00Z"),
};

describe("activityStats", () => {
  it("emits the six tiles in their settled order", () => {
    const stats = activityStats({
      ...base,
      durationS: 3600,
      distanceM: 42195,
      load: 87.4,
      avgHr: 142.6,
      avgPower: 210.2,
      elevationM: 512.8,
    });
    expect(stats.map((s) => s.label)).toEqual([
      "Duration",
      "Distance",
      "Load",
      "Avg HR",
      "Avg Power",
      "Climb",
    ]);
    expect(stats.map((s) => s.value)).toEqual([
      "1h 00m",
      "42.2",
      "87",
      "143",
      "210",
      "513",
    ]);
    expect(stats.map((s) => s.unit)).toEqual([
      undefined,
      "km",
      undefined,
      "bpm",
      "W",
      "m",
    ]);
  });

  it("omits a missing stat rather than showing it as zero", () => {
    const stats = activityStats({ ...base, durationS: 1800, load: null });
    expect(stats.map((s) => s.label)).toEqual(["Duration"]);
  });

  it("keeps a real zero, which is a reading and not an absence", () => {
    const stats = activityStats({ ...base, elevationM: 0 });
    expect(stats).toEqual([{ label: "Climb", value: "0", unit: "m" }]);
  });
});

describe("activityMeta", () => {
  // The drift this module exists to close: Today printed the raw enum while
  // /activity/[id] mapped it. "manual" is the case an athlete could reach —
  // Today's query excludes Strava rows, so that pair never rendered.
  it("spells every provider the way the athlete would recognise it", () => {
    const spell = (provider: string) =>
      activityMeta({ ...base, provider }).split(" · ").at(-1);
    expect(spell("manual")).toBe("logged by hand");
    expect(spell("intervals_icu")).toBe("intervals.icu");
    expect(spell("strava")).toBe("Strava");
  });

  it("falls back to the provider's own name when it has no spelling", () => {
    expect(activityMeta({ ...base, provider: "garmin" })).toContain("garmin");
  });

  it("reads the athlete's local day, not the stored instant", () => {
    // Midday and four days apart, so the assertion holds in any timezone the
    // suite runs in — the point is which field is read, not the offset.
    expect(
      activityMeta({
        ...base,
        startDate: new Date("2026-08-11T12:00:00Z"),
        startDateLocal: new Date("2026-08-15T12:00:00Z"),
      })
    ).toContain("Aug 15");
  });
});
