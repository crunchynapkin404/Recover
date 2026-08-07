import { describe, expect, it } from "vitest";
import {
  raceWeekWorkouts,
  taperFractionForWeek,
  taperWindowDays,
  TAPER_FRACTION_RACE_WEEK,
  TAPER_FRACTION_WEEK_1,
  TAPER_FRACTION_WEEK_2,
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
