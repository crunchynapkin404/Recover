import { describe, expect, it } from "vitest";
import { PLAN_PHASES } from "@/lib/plan-phase";
import {
  oneRmsFromBodyPrefs,
  STRENGTH_SESSION_LOAD,
  strengthPrescription,
  type OneRepMaxes,
} from "./prescription";

const ALL_SET: OneRepMaxes = {
  squatOneRmKg: 200,
  benchOneRmKg: 100,
  deadliftOneRmKg: 240,
  overheadPressOneRmKg: 60,
};

describe("strengthPrescription", () => {
  // Each phase asserted on its OWN row, not "returns something" — the phase
  // table is the whole feature, and a test that cannot tell base from peak
  // does not pin it. Fixtures differ per row so a swapped table is caught.
  it("prescribes volume in base: 4x8 at 65%", () => {
    const rx = strengthPrescription("base", ALL_SET);
    const squat = rx.find((e) => e.lift === "Squat")!;
    expect(squat.sets).toBe(4);
    expect(squat.reps).toBe(8);
    expect(squat.pctOneRm).toBe(0.65);
    expect(squat.targetLoadKg).toBe(130); // 200 * 0.65
  });

  it("prescribes 4x5 at 75% in build", () => {
    const squat = strengthPrescription("build", ALL_SET).find(
      (e) => e.lift === "Squat"
    )!;
    expect(squat.sets).toBe(4);
    expect(squat.reps).toBe(5);
    expect(squat.pctOneRm).toBe(0.75);
    expect(squat.targetLoadKg).toBe(150);
  });

  it("prescribes low-volume 3x3 at 82% in peak", () => {
    const squat = strengthPrescription("peak", ALL_SET).find(
      (e) => e.lift === "Squat"
    )!;
    expect(squat.sets).toBe(3);
    expect(squat.reps).toBe(3);
    expect(squat.pctOneRm).toBe(0.82);
    expect(squat.targetLoadKg).toBe(164);
  });

  it("prescribes maintenance 2x3 at 78% in taper", () => {
    const squat = strengthPrescription("taper", ALL_SET).find(
      (e) => e.lift === "Squat"
    )!;
    expect(squat.sets).toBe(2);
    expect(squat.reps).toBe(3);
    expect(squat.pctOneRm).toBe(0.78);
    expect(squat.targetLoadKg).toBe(156);
  });

  it("deloads to 2x8 at 55% in recovery", () => {
    const squat = strengthPrescription("recovery", ALL_SET).find(
      (e) => e.lift === "Squat"
    )!;
    expect(squat.sets).toBe(2);
    expect(squat.reps).toBe(8);
    expect(squat.pctOneRm).toBe(0.55);
    expect(squat.targetLoadKg).toBe(110);
  });

  it("covers all four lifts in every phase", () => {
    for (const phase of PLAN_PHASES) {
      const rx = strengthPrescription(phase, ALL_SET);
      expect(rx.map((e) => e.lift).sort()).toEqual([
        "Bench",
        "Deadlift",
        "OverheadPress",
        "Squat",
      ]);
    }
  });

  it("refuses a load per-lift, not per-session, when a 1RM is unset", () => {
    // The whole point of the refuse-state: one missing max must not blank
    // the other three lifts' targets.
    const rx = strengthPrescription("base", {
      ...ALL_SET,
      benchOneRmKg: null,
    });
    expect(rx.find((e) => e.lift === "Bench")!.targetLoadKg).toBeNull();
    expect(rx.find((e) => e.lift === "Squat")!.targetLoadKg).toBe(130);
  });

  it("still prescribes sets and reps for a lift with no 1RM", () => {
    const bench = strengthPrescription("base", {
      ...ALL_SET,
      benchOneRmKg: null,
    }).find((e) => e.lift === "Bench")!;
    expect(bench.sets).toBe(4);
    expect(bench.reps).toBe(8);
  });

  it("returns every lift unloaded when no maxes are set at all", () => {
    const rx = strengthPrescription("base", null);
    expect(rx).toHaveLength(4);
    expect(rx.every((e) => e.targetLoadKg === null)).toBe(true);
  });

  it("keeps strength load below the endurance duration rung", () => {
    // 30 < DURATION_TSS_PER_HOUR (40). This figure must never read as
    // commensurate with an endurance TSS.
    expect(STRENGTH_SESSION_LOAD).toBe(30);
  });
});

describe("oneRmsFromBodyPrefs", () => {
  // The whole point of this function: a bodyPrefs row already exists for
  // most athletes today (FTP, weight, pace), created long before any of
  // them ever visits the new strength fields. Treating that pre-existing
  // row as an opt-in (rather than "no row" being the only opt-out) would
  // silently start scheduling strength for nearly every existing athlete
  // on their next rollover.

  it("returns null when there is no row at all", () => {
    expect(oneRmsFromBodyPrefs(null)).toBeNull();
    expect(oneRmsFromBodyPrefs(undefined)).toBeNull();
  });

  it("returns null when the row exists but all four maxima are still null", () => {
    expect(
      oneRmsFromBodyPrefs({
        squatOneRmKg: null,
        benchOneRmKg: null,
        deadliftOneRmKg: null,
        overheadPressOneRmKg: null,
      })
    ).toBeNull();
  });

  it("opts in on exactly one maximum being set", () => {
    // Any ONE lift is enough — the other three simply refuse their own
    // load in strengthPrescription(), rather than blocking the session.
    expect(
      oneRmsFromBodyPrefs({
        squatOneRmKg: 150,
        benchOneRmKg: null,
        deadliftOneRmKg: null,
        overheadPressOneRmKg: null,
      })
    ).toEqual({
      squatOneRmKg: 150,
      benchOneRmKg: null,
      deadliftOneRmKg: null,
      overheadPressOneRmKg: null,
    });
  });

  it("passes every value through unchanged when all four are set", () => {
    expect(oneRmsFromBodyPrefs(ALL_SET)).toEqual(ALL_SET);
  });
});
