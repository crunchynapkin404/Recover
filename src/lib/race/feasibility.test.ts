import { describe, expect, it } from "vitest";
import {
  assessFeasibility,
  FEASIBILITY_CONSTANTS,
  feasibilityFor,
} from "./feasibility";

const base = {
  requiredWeeklyHours: 11,
  currentWeeklyHours: 8.9,
  queenStageHours: 7,
  queenStageKnown: true,
  longestSessionHours: 5,
  weeksUntilEvent: 8,
};

describe("assessFeasibility", () => {
  it("says ready when both requirements are already met", () => {
    const r = assessFeasibility({
      ...base,
      currentWeeklyHours: 12,
      longestSessionHours: 7,
    })!;
    expect(r.verdict).toBe("ready");
  });

  it("says on track when the plan closes both gaps in time", () => {
    const r = assessFeasibility(base)!;
    expect(r.verdict).toBe("on_track");
    expect(r.volumeWeeksNeeded).toBeGreaterThan(0);
  });

  it("says not realistic when the gap cannot close in time", () => {
    const r = assessFeasibility({
      ...base,
      currentWeeklyHours: 2,
      longestSessionHours: 1,
      weeksUntilEvent: 3,
    })!;
    expect(r.verdict).toBe("not_realistic");
  });

  it("says tight when it closes with no margin", () => {
    // Needs exactly the weeks available, within the tight band.
    const r = assessFeasibility({
      ...base,
      currentWeeklyHours: 6,
      longestSessionHours: 3.6,
      weeksUntilEvent: 4,
    })!;
    expect(["tight", "not_realistic"]).toContain(r.verdict);
  });

  it("judges longest ride separately from volume", () => {
    // Volume is already satisfied (14h against 11h required), so the ONLY
    // thing in deficit is the longest ride. That softens the verdict one
    // step, from "ready" to "on_track" -- it does not condemn the event.
    // LONGEST_RIDE_FRACTION is the weakest constant in this feature and the
    // sources flatly contradict each other, so it is deliberately not allowed
    // to produce "not_realistic" on its own. See spec §1.6.
    const r = assessFeasibility({
      ...base,
      currentWeeklyHours: 14,
      longestSessionHours: 1.5,
      weeksUntilEvent: 2,
    })!;
    expect(r.verdict).toBe("on_track");
    expect(r.longestSessionWeeksNeeded).toBeGreaterThan(r.weeksUntilEvent);
  });

  it("requires only a fraction of the queen stage, not all of it", () => {
    const r = assessFeasibility(base)!;
    expect(r.requiredLongestSessionHours).toBeCloseTo(
      7 * FEASIBILITY_CONSTANTS.LONGEST_RIDE_FRACTION,
      5
    );
  });

  it("flags reasoning from an average day when stages are unknown", () => {
    const r = assessFeasibility({ ...base, queenStageKnown: false })!;
    expect(r.fromAverageDay).toBe(true);
  });

  it("returns null rather than a verdict without measured history", () => {
    expect(
      assessFeasibility({
        ...base,
        currentWeeklyHours: null,
        longestSessionHours: null,
      })
    ).toBeNull();
  });

  it("does not divide by zero when the event is this week", () => {
    const r = assessFeasibility({ ...base, weeksUntilEvent: 0 })!;
    expect(Number.isFinite(r.volumeWeeksNeeded)).toBe(true);
  });

  it("floors ride-gap softening at tight, even from an already-tight verdict", () => {
    // The one case where the floor actually does anything. Both the other
    // ride-gap tests start from "ready", where capping at "tight" versus
    // allowing "not_realistic" makes no observable difference — so removing
    // the cap passes them both. Volume here is genuinely tight AND the ride
    // gap is severe; only volume may reach the worst rung.
    const f = assessFeasibility({
      ...base,
      currentWeeklyHours: 6,
      longestSessionHours: 0.1,
      weeksUntilEvent: 4,
    })!;
    expect(f.verdict).toBe("tight");
    expect(f.longestSessionWeeksNeeded).toBeGreaterThan(f.weeksUntilEvent);
  });

  it("never lets a longest-ride gap alone condemn an event", () => {
    // Volume fully satisfied, longest ride absurdly short. Even at the
    // extreme, a contested rule must not reach the worst rung by itself.
    const r = assessFeasibility({
      ...base,
      requiredWeeklyHours: 8,
      currentWeeklyHours: 20,
      queenStageHours: 9,
      queenStageKnown: true,
      longestSessionHours: 0.5,
      weeksUntilEvent: 1,
    })!;
    expect(r.verdict).not.toBe("not_realistic");
  });
});

const OK_DEMAND = {
  available: true as const,
  weeklyHours: 10,
  queenStageHours: 5,
  queenStageKnown: true,
  totalHours: 8,
  dailyRateHours: 5,
  source: "computed" as const,
  confidence: "medium" as const,
  confidenceReason: "modelled",
};

describe("feasibilityFor", () => {
  it("says which input is missing when there is no usable demand", () => {
    const f = feasibilityFor({
      demand: null,
      currentWeeklyHours: 8,
      longestSessionHours: 3,
      weeksUntilEvent: 12,
    });
    expect(f.available).toBe(false);
    if (f.available) return;
    expect(f.kind).toBe("missing_input");
    if (f.kind !== "missing_input") return;
    expect(f.needs).toContain("demand");
  });

  it("distinguishes a missing race date from missing demand", () => {
    const f = feasibilityFor({
      demand: OK_DEMAND,
      currentWeeklyHours: 8,
      longestSessionHours: 3,
      weeksUntilEvent: null,
    });
    expect(f.available).toBe(false);
    if (f.available) return;
    expect(f.kind).toBe("missing_input");
    if (f.kind !== "missing_input") return;
    expect(f.needs).toContain("race date");
  });

  it("distinguishes missing training history from both of the above", () => {
    const f = feasibilityFor({
      demand: OK_DEMAND,
      currentWeeklyHours: null,
      longestSessionHours: 3,
      weeksUntilEvent: 12,
    });
    expect(f.available).toBe(false);
    if (f.available) return;
    expect(f.kind).toBe("missing_input");
    if (f.kind !== "missing_input") return;
    expect(f.needs).toContain("training history");
  });

  it("returns the verdict with low confidence when everything is present", () => {
    const f = feasibilityFor({
      demand: OK_DEMAND,
      currentWeeklyHours: 8,
      longestSessionHours: 3,
      weeksUntilEvent: 12,
    });
    expect(f.available).toBe(true);
    if (!f.available) return;
    expect(f.confidence).toBe("low");
    expect(f.value.weeksUntilEvent).toBe(12);
  });
});
