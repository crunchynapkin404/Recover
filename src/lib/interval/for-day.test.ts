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
