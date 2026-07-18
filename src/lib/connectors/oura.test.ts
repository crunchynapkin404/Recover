import { describe, expect, it } from "vitest";
import { mapOuraDays } from "./oura";

// Fixtures shaped like real Oura v2 records.
function sleep(overrides: Record<string, unknown> = {}) {
  return {
    day: "2026-07-15",
    type: "long_sleep",
    deep_sleep_duration: 5400,
    rem_sleep_duration: 5400,
    light_sleep_duration: 14400,
    awake_time: 1200,
    total_sleep_duration: 25200,
    bedtime_start: "2026-07-14T23:10:00+02:00",
    bedtime_end: "2026-07-15T07:05:00+02:00",
    average_hrv: 65,
    lowest_heart_rate: 46,
    average_breath: 14.2,
    ...overrides,
  };
}

describe("mapOuraDays", () => {
  it("maps a main sleep + daily score + readiness temp onto its day", () => {
    const days = mapOuraDays(
      [sleep()],
      [{ day: "2026-07-15", score: 84 }],
      [{ day: "2026-07-15", temperature_deviation: -0.2 }]
    );
    const day = days.get("2026-07-15");
    expect(day).toBeTruthy();
    expect(day!.sleepSecs).toBe(25200);
    expect(day!.sleepDeepSecs).toBe(5400);
    expect(day!.sleepRemSecs).toBe(5400);
    expect(day!.sleepLightSecs).toBe(14400);
    expect(day!.sleepAwakeSecs).toBe(1200);
    expect(day!.hrvMs).toBe(65);
    expect(day!.restingHr).toBe(46);
    expect(day!.respiratoryRate).toBe(14.2);
    expect(day!.sleepScore).toBe(84);
    expect(day!.tempDeviationC).toBe(-0.2);
    expect(day!.bedStart).toBeInstanceOf(Date);
  });

  it("drops naps and non-long sleep types", () => {
    const days = mapOuraDays([sleep({ type: "late_nap" })], [], []);
    expect(days.size).toBe(0);
  });

  it("falls back to summed stages when total is missing", () => {
    const days = mapOuraDays([sleep({ total_sleep_duration: null })], [], []);
    expect(days.get("2026-07-15")!.sleepSecs).toBe(5400 + 5400 + 14400);
  });

  it("keeps the longest main sleep for a day", () => {
    const days = mapOuraDays(
      [
        sleep({ total_sleep_duration: 18000 }),
        sleep({ total_sleep_duration: 27000 }),
      ],
      [],
      []
    );
    expect(days.get("2026-07-15")!.sleepSecs).toBe(27000);
  });

  it("carries temperature deviation on days with no sleep row", () => {
    const days = mapOuraDays(
      [],
      [],
      [{ day: "2026-07-16", temperature_deviation: 0.4 }]
    );
    expect(days.get("2026-07-16")).toEqual({ tempDeviationC: 0.4 });
  });

  it("treats a sleep row with no type as the main sleep", () => {
    const days = mapOuraDays([sleep({ type: undefined })], [], []);
    expect(days.get("2026-07-15")).toBeTruthy();
  });
});
