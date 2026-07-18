import { describe, expect, it } from "vitest";
import { mapWhoopDays } from "./whoop";

// Fixtures shaped like real Whoop v2 records (developer/v2 docs).
function sleep(overrides: Record<string, unknown> = {}) {
  return {
    id: "sleep-1",
    start: "2026-07-14T23:10:00.000Z",
    end: "2026-07-15T07:05:00.000Z",
    nap: false,
    score_state: "SCORED",
    score: {
      stage_summary: {
        total_light_sleep_time_milli: 14_400_000, // 4h
        total_slow_wave_sleep_time_milli: 5_400_000, // 1.5h
        total_rem_sleep_time_milli: 5_400_000, // 1.5h
        total_awake_time_milli: 1_200_000, // 20m
      },
      sleep_performance_percentage: 88,
      respiratory_rate: 14.5,
    },
    ...overrides,
  };
}

function recovery(overrides: Record<string, unknown> = {}) {
  return {
    sleep_id: "sleep-1",
    score_state: "SCORED",
    score: {
      hrv_rmssd_milli: 62.3,
      resting_heart_rate: 48,
      user_calibrating: false,
    },
    ...overrides,
  };
}

describe("mapWhoopDays", () => {
  it("maps a scored sleep + its recovery onto the wake date", () => {
    const days = mapWhoopDays([sleep()], [recovery()]);
    const day = days.get("2026-07-15");
    expect(day).toBeTruthy();
    expect(day!.sleepSecs).toBe((14_400 + 5_400 + 5_400) * 1); // light+deep+rem
    expect(day!.sleepDeepSecs).toBe(5_400);
    expect(day!.sleepRemSecs).toBe(5_400);
    expect(day!.sleepLightSecs).toBe(14_400);
    expect(day!.sleepAwakeSecs).toBe(1_200);
    expect(day!.sleepScore).toBe(88);
    expect(day!.respiratoryRate).toBe(14.5);
    expect(day!.hrvMs).toBe(62.3);
    expect(day!.restingHr).toBe(48);
    expect(day!.bedEnd).toBeInstanceOf(Date);
  });

  it("ignores naps", () => {
    const days = mapWhoopDays([sleep({ nap: true })], []);
    expect(days.size).toBe(0);
  });

  it("skips unscored sleep and unscored/calibrating recovery", () => {
    const unscored = mapWhoopDays(
      [sleep({ score_state: "PENDING_SCORE" })],
      []
    );
    expect(unscored.size).toBe(0);

    const calibrating = mapWhoopDays(
      [sleep()],
      [recovery({ score: { hrv_rmssd_milli: 60, user_calibrating: true } })]
    );
    // Sleep still maps; HRV/RHR are absent because the recovery is calibrating.
    const day = calibrating.get("2026-07-15");
    expect(day!.hrvMs).toBeUndefined();
    expect(day!.sleepSecs).toBeGreaterThan(0);
  });

  it("keeps the longer of two non-nap sleeps ending the same date", () => {
    const short = sleep({
      id: "s-short",
      score: { stage_summary: { total_light_sleep_time_milli: 3_600_000 } },
    });
    const long = sleep({ id: "s-long" });
    const days = mapWhoopDays([short, long], []);
    expect(days.get("2026-07-15")!.sleepSecs).toBe(14_400 + 5_400 + 5_400);
  });

  it("does not join a recovery to the wrong sleep", () => {
    const days = mapWhoopDays(
      [sleep()],
      [recovery({ sleep_id: "different-sleep" })]
    );
    const day = days.get("2026-07-15");
    expect(day!.hrvMs).toBeUndefined();
    expect(day!.restingHr).toBeUndefined();
  });
});
