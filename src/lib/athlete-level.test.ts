import { describe, expect, it } from "vitest";
import { athleteLevel, LEVEL_CONSTANTS } from "./athlete-level";

const flat = (value: number, weeks = 12): number[] =>
  Array.from({ length: weeks }, () => value);

describe("athleteLevel", () => {
  it("grades the calibration athlete Intermediate with an 11.6h ceiling", () => {
    // 8.9h/week peak -> Intermediate (5-9h). CTL 80 -> Advanced boundary.
    // The lower of the two wins.
    const r = athleteLevel({
      weeklyHoursByWeek: flat(8.9),
      ctlByWeek: flat(80),
      override: null,
    });
    expect(r.level).toBe("intermediate");
    expect(r.ceilingHours).toBeCloseTo(8.9 * LEVEL_CONSTANTS.HEADROOM, 3);
    expect(r.ceilingHours).toBeCloseTo(11.57, 1);
  });

  it("takes the LOWER of the hours and CTL verdicts", () => {
    // High CTL from short hard sessions must not claim 4-hour-ride capacity.
    const r = athleteLevel({
      weeklyHoursByWeek: flat(4),
      ctlByWeek: flat(95),
      override: null,
    });
    expect(r.level).toBe("amateur");
  });

  it("takes the LOWER verdict when CTL restricts high hours", () => {
    // Many easy hours must not claim VO2max tolerance: 12h/week alone would
    // grade Advanced, but a CTL of 20 caps it at Recreational.
    const r = athleteLevel({
      weeklyHoursByWeek: flat(12),
      ctlByWeek: flat(20),
      override: null,
    });
    expect(r.level).toBe("recreational");
  });

  it("is unmoved by a bad fortnight — the rolling peak holds", () => {
    const history = flat(9, 10).concat([0.5, 0.5]);
    const r = athleteLevel({
      weeklyHoursByWeek: history,
      ctlByWeek: flat(80),
      override: null,
    });
    expect(r.level).toBe("advanced");
    expect(r.peakHours).toBe(9);
  });

  it("drops once the peak rolls out of the window", () => {
    // Genuine detraining: nothing high left anywhere in the window.
    const r = athleteLevel({
      weeklyHoursByWeek: flat(2, 12),
      ctlByWeek: flat(30),
      override: null,
    });
    expect(r.level).toBe("recreational");
  });

  it("only considers the most recent PEAK_WINDOW_WEEKS", () => {
    const ancient = [20, 20].concat(flat(2, 12));
    const r = athleteLevel({
      weeklyHoursByWeek: ancient,
      ctlByWeek: flat(30),
      override: null,
    });
    expect(r.peakHours).toBe(2);
  });

  it("lets an override win outright", () => {
    const r = athleteLevel({
      weeklyHoursByWeek: flat(2),
      ctlByWeek: flat(30),
      override: "advanced",
    });
    expect(r.level).toBe("advanced");
    expect(r.source).toBe("override");
  });

  it("reports calibrating rather than guessing without history", () => {
    const r = athleteLevel({
      weeklyHoursByWeek: [],
      ctlByWeek: [],
      override: null,
    });
    expect(r.level).toBeNull();
    expect(r.ceilingHours).toBeNull();
    expect(r.source).toBe("calibrating");
  });

  it("still reports a ceiling from hours alone while CTL history is missing", () => {
    // Asymmetric on purpose: real peak-hours history is usable evidence even
    // when we can't yet grade a level, and Task 6 needs it either way.
    const r = athleteLevel({
      weeklyHoursByWeek: flat(6),
      ctlByWeek: [],
      override: null,
    });
    expect(r.level).toBeNull();
    expect(r.source).toBe("calibrating");
    expect(r.ceilingHours).not.toBeNull();
    expect(r.ceilingHours).toBeCloseTo(6 * LEVEL_CONSTANTS.HEADROOM, 3);
  });

  it("refuses to grade a level from non-finite peak input instead of defaulting to advanced", () => {
    // A NaN peak (e.g. corrupt upstream data) makes every `value < band.max`
    // comparison false; without a guard the band loop falls through to the
    // most permissive band. It must report no level, not "advanced".
    const r = athleteLevel({
      weeklyHoursByWeek: [NaN, NaN, NaN],
      ctlByWeek: flat(50),
      override: null,
    });
    expect(r.level).toBeNull();
    expect(r.level).not.toBe("advanced");
    expect(r.source).toBe("calibrating");
  });

  it("keeps the ceiling continuous, with no cliff at a band edge", () => {
    // 8.9h and 9.1h straddle the Intermediate/Advanced boundary. Their
    // ceilings must stay close — the band changes, the ceiling does not jump.
    const a = athleteLevel({
      weeklyHoursByWeek: flat(8.9),
      ctlByWeek: flat(80),
      override: null,
    });
    const b = athleteLevel({
      weeklyHoursByWeek: flat(9.1),
      ctlByWeek: flat(80),
      override: null,
    });
    expect(Math.abs(a.ceilingHours! - b.ceilingHours!)).toBeLessThan(0.5);
  });
});
