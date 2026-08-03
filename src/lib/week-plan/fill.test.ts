import { describe, expect, it } from "vitest";
import { fillCeilingMins } from "./fill";
import {
  EASY_RUN_CAP_MINS,
  NO_DEMAND_LONG_BOUND_MINS,
} from "@/lib/training-plan";

describe("fillCeilingMins", () => {
  // queenStageHours of 5, not 4: longRideBoundMins(4) collides with
  // NO_DEMAND_LONG_BOUND_MINS (both 240), so at 4 hours these assertions
  // could not tell a branch that genuinely calls longRideBoundMins apart
  // from one that ignores the argument and hardcodes 240. At 5 hours the
  // derived bound (300) is distinct from the fallback.
  it("bounds a bike session by the event's queen stage", () => {
    expect(fillCeilingMins("long", "Bike", 5)).toBe(300);
    expect(fillCeilingMins("aerobic_base", "Bike", 5)).toBe(300);
  });

  it("derives a queen-stage bound distinct from the no-demand fallback", () => {
    expect(fillCeilingMins("long", "Bike", 5)).not.toBe(
      fillCeilingMins("long", "Bike", null)
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
