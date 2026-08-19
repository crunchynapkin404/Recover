import { describe, expect, it } from "vitest";
import { planRaceTargets } from "./plan-targets";

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
