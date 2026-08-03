import { describe, expect, it } from "vitest";
import { fillCeilingMins } from "./fill";
import {
  EASY_RUN_CAP_MINS,
  NO_DEMAND_LONG_BOUND_MINS,
  longRideBoundMins,
} from "@/lib/training-plan";

describe("fillCeilingMins", () => {
  it("bounds a bike session by the event's queen stage", () => {
    expect(fillCeilingMins("long", "Bike", 4)).toBe(longRideBoundMins(4));
    expect(fillCeilingMins("aerobic_base", "Bike", 4)).toBe(
      longRideBoundMins(4)
    );
  });

  it("falls back to the no-demand bound when there is no event", () => {
    expect(fillCeilingMins("long", "Bike", null)).toBe(
      NO_DEMAND_LONG_BOUND_MINS
    );
  });

  it("bounds an easy run by the named easy-run cap", () => {
    expect(fillCeilingMins("aerobic_base", "Run", 4)).toBe(EASY_RUN_CAP_MINS);
  });

  it("refuses a long run — that rule is athlete-relative and does not exist yet", () => {
    expect(fillCeilingMins("long", "Run", 4)).toBeNull();
  });

  it("refuses every swim, having no bound it can defend", () => {
    expect(fillCeilingMins("aerobic_base", "Swim", 4)).toBeNull();
    expect(fillCeilingMins("long", "Swim", 4)).toBeNull();
  });

  it("refuses every purpose that is not endurance", () => {
    for (const p of ["vo2max", "threshold", "brick", "recovery"] as const) {
      expect(fillCeilingMins(p, "Bike", 4)).toBeNull();
    }
  });
});
