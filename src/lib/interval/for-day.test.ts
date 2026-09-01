import { describe, it, expect } from "vitest";
import { workoutForDay } from "./for-day";
import { totalSecs } from "./duration";

const DATE = "2026-09-01";

describe("workoutForDay", () => {
  it("returns a fitted workout for a cycling day the library answers", () => {
    const got = workoutForDay(
      { sport: "Bike", purpose: "threshold", durationMins: 75 },
      DATE
    );
    expect(got).not.toBeNull();
    expect(totalSecs(got!.blocks)).toBe(75 * 60);
    expect(got!.description).not.toBe("");
    expect(got!.profile.length).toBeGreaterThan(0);
    expect(got!.workout.source).toMatch(/Confidence:/);
  });

  it("refuses without saying why, which is all the surface needs", () => {
    // Not cycling, not a library purpose, and nothing that fits the length —
    // three different refusals, one shape, because the day renders the same
    // prose and band in every case.
    expect(
      workoutForDay(
        { sport: "Run", purpose: "threshold", durationMins: 75 },
        DATE
      )
    ).toBeNull();
    expect(
      workoutForDay(
        { sport: "Bike", purpose: "strength", durationMins: 75 },
        DATE
      )
    ).toBeNull();
    expect(
      workoutForDay(
        { sport: "Bike", purpose: "vo2max", durationMins: 400 },
        DATE
      )
    ).toBeNull();
  });

  it("is deterministic for a given day", () => {
    const a = workoutForDay(
      { sport: "Bike", purpose: "aerobic_base", durationMins: 90 },
      DATE
    );
    const b = workoutForDay(
      { sport: "Bike", purpose: "aerobic_base", durationMins: 90 },
      DATE
    );
    expect(a!.workout.id).toBe(b!.workout.id);
  });

  it("answers every duration the library promises to cover", () => {
    // The coverage guard proves the library has no holes; this proves the
    // path the app actually calls reaches them.
    const cases: [string, number, number][] = [
      ["recovery", 20, 90],
      ["aerobic_base", 21, 210],
      ["long", 48, 300],
      ["threshold", 27, 120],
      ["vo2max", 32, 120],
    ];
    for (const [purpose, lo, hi] of cases) {
      for (let m = lo; m <= hi; m++) {
        const got = workoutForDay(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { sport: "Bike", purpose: purpose as any, durationMins: m },
          DATE
        );
        expect(got, `${purpose} refused ${m} min`).not.toBeNull();
        expect(totalSecs(got!.blocks), `${purpose} inexact at ${m}`).toBe(
          m * 60
        );
      }
    }
  });
});

describe("workoutForDay — a pinned session", () => {
  // 75 minutes is a length TWO threshold workouts span (thr-4x8 73-94 and
  // ou-3x12 73-97), so pinning one can be told apart from the natural pick.
  // A length only one workout covers would make this test pass either way.
  const pin = {
    workoutId: "ou-3x12",
    exportedAt: "2026-09-01T07:00:00.000Z",
    purpose: "threshold" as const,
    durationMins: 75,
  };

  it("renders the workout that was sent, not the one that would be chosen now", () => {
    // Unpinned, a 62-minute threshold day picks whatever the date seed lands
    // on. Pinned, it must show ss-2x12 — the athlete's head unit has that one.
    const unpinned = workoutForDay(
      { sport: "Bike", purpose: "threshold", durationMins: 75 },
      DATE
    );
    const pinned = workoutForDay(
      { sport: "Bike", purpose: "threshold", durationMins: 75, pin },
      DATE
    );
    expect(pinned!.workout.id).toBe("ou-3x12");
    // The test is only meaningful if the two genuinely differ.
    expect(unpinned!.workout.id).not.toBe("ou-3x12");
  });

  it("renders it at the length it was exported at, not the day's new length", () => {
    // The day since shrank to 53 minutes. The device still holds 75.
    const got = workoutForDay(
      { sport: "Bike", purpose: "threshold", durationMins: 53, pin },
      DATE
    );
    expect(got!.workout.id).toBe("ou-3x12");
    expect(totalSecs(got!.blocks)).toBe(75 * 60);
  });

  it("holds the pin even when the day's purpose changed underneath it", () => {
    // Amber steps Tempo down to Endurance. Recover keeps showing what it sent
    // and marks it stale rather than silently swapping the session.
    const got = workoutForDay(
      { sport: "Bike", purpose: "aerobic_base", durationMins: 75, pin },
      DATE
    );
    expect(got!.workout.id).toBe("ou-3x12");
  });

  it("falls back to a fresh match when the pinned id is gone from the library", () => {
    const got = workoutForDay(
      {
        sport: "Bike",
        purpose: "threshold",
        durationMins: 75,
        pin: { ...pin, workoutId: "deleted-long-ago" },
      },
      DATE
    );
    expect(got).not.toBeNull();
    expect(totalSecs(got!.blocks)).toBe(75 * 60);
  });
});
