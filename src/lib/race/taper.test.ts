import { describe, expect, it } from "vitest";
import {
  raceWeekWorkouts,
  taperFractionForWeek,
  taperWindowDays,
  TAPER_FRACTION_RACE_WEEK,
  TAPER_FRACTION_WEEK_1,
  TAPER_FRACTION_WEEK_2,
  TAPER_WINDOW_LONG,
  TAPER_WINDOW_MID,
  TAPER_WINDOW_SHORT,
} from "./taper";

const race = (date: string, raceType: string) => ({
  date,
  raceType,
  priority: "A" as const,
  name: "Test race",
});

// v0.45 Task 4 re-review, Finding 1: every OTHER test that touches these
// constants imports them and checks production output against that SAME
// import — e.g. `targetLoad / TAPER_FRACTION_WEEK_2` in
// training-plan.test.ts, or `toBe(TAPER_FRACTION_WEEK_2)` in the
// `taperFractionForWeek` describe block below. If the exported VALUE of a
// constant changes (not which branch reads it), production and the
// assertion move together and the test still passes — a swapped constant
// is invisible to all of them. This is the one place that pins the actual
// numbers, so a swap fails loudly here even though it fails nowhere else.
describe("TAPER_FRACTION_* ladder — pinned to literal values", () => {
  it("pins the taper ladder", () => {
    expect(TAPER_FRACTION_RACE_WEEK).toBe(0.45);
    expect(TAPER_FRACTION_WEEK_1).toBe(0.65);
    expect(TAPER_FRACTION_WEEK_2).toBe(0.8);
  });
});

describe("taperWindowDays", () => {
  it("maps distance to window", () => {
    expect(taperWindowDays("marathon")).toBe(21);
    expect(taperWindowDays("Ironman 70.3")).toBe(14);
    expect(taperWindowDays("half marathon")).toBe(14);
    expect(taperWindowDays("gran fondo")).toBe(14);
    expect(taperWindowDays("10k")).toBe(10);
    expect(taperWindowDays("weird unknown")).toBe(10);
    expect(taperWindowDays("ironman")).toBe(21);
  });
});

describe("taperFractionForWeek", () => {
  // Race on Sunday 2026-08-30; weeks start Mondays.
  const marathon = race("2026-08-30", "marathon");
  it("race week gets the race-week fraction", () => {
    expect(taperFractionForWeek("2026-08-24", marathon)).toBe(
      TAPER_FRACTION_RACE_WEEK
    );
  });
  it("week-1 and week-2 taper for a 21-day window", () => {
    expect(taperFractionForWeek("2026-08-17", marathon)).toBe(
      TAPER_FRACTION_WEEK_1
    );
    expect(taperFractionForWeek("2026-08-10", marathon)).toBe(
      TAPER_FRACTION_WEEK_2
    );
    expect(taperFractionForWeek("2026-08-03", marathon)).toBeNull();
  });
  it("a 10-day window only tapers race week", () => {
    const tenK = race("2026-08-30", "10k");
    expect(taperFractionForWeek("2026-08-24", tenK)).toBe(
      TAPER_FRACTION_RACE_WEEK
    );
    expect(taperFractionForWeek("2026-08-17", tenK)).toBeNull();
  });
  it("a 14-day window tapers race week and week-1 only", () => {
    const half = race("2026-08-30", "half marathon");
    expect(taperFractionForWeek("2026-08-17", half)).toBe(
      TAPER_FRACTION_WEEK_1
    );
    expect(taperFractionForWeek("2026-08-10", half)).toBeNull();
  });
  it("weeks after the race never taper", () => {
    expect(taperFractionForWeek("2026-08-31", marathon)).toBeNull();
  });
});

describe("raceWeekWorkouts", () => {
  it("Sunday race: short endurance Thu, openers Fri, nothing Sat", () => {
    const w = raceWeekWorkouts("Run", 6);
    expect(w).toHaveLength(2);
    expect(w[0]).toMatchObject({ day: 3, type: "Endurance", durationMins: 30 });
    expect(w[1]).toMatchObject({ day: 4, type: "Tempo", durationMins: 20 });
  });
  it("early-week race fits what it can", () => {
    expect(raceWeekWorkouts("Run", 1)).toHaveLength(0);
    expect(raceWeekWorkouts("Bike", 2)).toHaveLength(1); // openers only
  });
});

/**
 * The two ceilings on TAPER_WINDOW_LONG, neither of which is visible from the
 * constant itself. Added by the 2026-08-19 evidence pass
 * (`docs/specs/2026-08-19-taper-evidence.md`) because Phase 3's multi-A-race
 * work runs this machinery twice per season, and because the constant turns
 * out to have no headroom at all.
 */
describe("taper window bounds", () => {
  /**
   * Ferreira et al. 2023 (PLOS One, endurance athletes) finds tapers of 22
   * days or more show DIMINISHED effects, while 15-21 days still improves
   * performance. 21 is therefore the last supported day, not a comfortable
   * middle. Raising this constant crosses the evidence.
   */
  it("keeps the long window at or under the 21-day evidence ceiling", () => {
    expect(TAPER_WINDOW_LONG).toBeLessThanOrEqual(21);
  });

  /**
   * `racesForWeek` (src/lib/race/service.ts) only looks 27 days ahead of the
   * week start, so a race further out than that is not returned and cannot be
   * tapered for at all. A window longer than the lookahead would be silently
   * truncated rather than refused — the failure would be a missing taper, with
   * nothing logged. If you raise the window, raise the lookahead first.
   */
  it("keeps every window inside racesForWeek's 27-day lookahead", () => {
    const LOOKAHEAD_DAYS = 27;
    for (const w of [TAPER_WINDOW_SHORT, TAPER_WINDOW_MID, TAPER_WINDOW_LONG]) {
      expect(w).toBeLessThanOrEqual(LOOKAHEAD_DAYS);
    }
  });

  /** The ladder must stay ordered, or taperWindowDays' `>=` comparisons in
   * taperFractionForWeek select the wrong rung. */
  it("keeps the three windows strictly ordered", () => {
    expect(TAPER_WINDOW_SHORT).toBeLessThan(TAPER_WINDOW_MID);
    expect(TAPER_WINDOW_MID).toBeLessThan(TAPER_WINDOW_LONG);
  });

  /**
   * Both meta-analyses put the effective VOLUME reduction at 41-60%. Race
   * week is the rung that has to land inside it: 0.45 of current load is a
   * 55% cut.
   */
  it("cuts race-week volume by an amount the evidence supports", () => {
    const reduction = 1 - TAPER_FRACTION_RACE_WEEK;
    expect(reduction).toBeGreaterThanOrEqual(0.41);
    expect(reduction).toBeLessThanOrEqual(0.6);
  });

  /**
   * Across the 2-week window — the largest-effect duration — the mean of the
   * two applied rungs must also sit inside the band.
   */
  it("keeps the two-week mean reduction inside the band", () => {
    const mean =
      (1 - TAPER_FRACTION_WEEK_1 + (1 - TAPER_FRACTION_RACE_WEEK)) / 2;
    expect(mean).toBeGreaterThanOrEqual(0.41);
    expect(mean).toBeLessThanOrEqual(0.6);
  });

  /**
   * Bosquet specifies an exponential FAST-DECAY taper rather than a step, so
   * each rung must fall by a larger factor than the one before it.
   */
  it("decays faster as race day approaches, not linearly", () => {
    const firstStep = TAPER_FRACTION_WEEK_1 / TAPER_FRACTION_WEEK_2;
    const secondStep = TAPER_FRACTION_RACE_WEEK / TAPER_FRACTION_WEEK_1;
    expect(secondStep).toBeLessThan(firstStep);
  });
});
