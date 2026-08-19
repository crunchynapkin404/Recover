import { describe, expect, it } from "vitest";
import { planRaceTargets, planWeekOf } from "./plan-targets";
import { addDaysYmd } from "./week-plan/service";

describe("planRaceTargets", () => {
  const single = {
    raceId: "r2",
    raceDate: "2026-10-11",
    raceType: "marathon",
    firstRaceId: null,
    firstRaceDate: null,
    firstRaceType: null,
  };

  it("returns no first race for a single-race plan", () => {
    expect(planRaceTargets(single).first).toBeNull();
    expect(planRaceTargets(single).final.id).toBe("r2");
  });

  it("names the earlier race as first and the plan end as final", () => {
    const two = {
      ...single,
      firstRaceId: "r1",
      firstRaceDate: "2026-09-06",
      firstRaceType: "half marathon",
    };
    expect(planRaceTargets(two).first?.id).toBe("r1");
    expect(planRaceTargets(two).final.id).toBe("r2");
  });

  it("is a no-op when the earlier race row was deleted", () => {
    // ON DELETE SET NULL nulls the id but leaves the denormalized date.
    // A two-race plan degrades to single-race rather than half-configured.
    const orphan = {
      ...single,
      firstRaceId: null,
      firstRaceDate: "2026-09-06",
      firstRaceType: "half marathon",
    };
    expect(planRaceTargets(orphan).first).toBeNull();
  });
});

/**
 * Task 5, fix round 1: `firstRace.weekNumber` at both live `periodize()`
 * call sites used to be `Math.ceil(daysBetween / 7)`, which undercounts by
 * one at every exact multiple of 7 — i.e. whenever the race falls on the
 * same weekday `plan.startDate` did. Week N spans days `7(N-1)..7N-1` from
 * `startDate`, so a race exactly 7 days out is in week 2, not week 1. Pure
 * — no database involved, so this isn't gated on `hasDb`. Moved here from
 * week-plan/service.test.ts in Task 6, alongside planWeekOf itself.
 */
describe("planWeekOf", () => {
  const START = "2026-01-05"; // Monday

  it.each([
    [6, 1],
    [7, 2],
    [8, 2],
    [13, 2],
    [14, 3],
  ])("day offset %i from plan.startDate is week %i", (offset, week) => {
    expect(planWeekOf(START, addDaysYmd(START, offset))).toBe(week);
  });
});
