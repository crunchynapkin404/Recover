import { describe, expect, it } from "vitest";
import {
  hoursForMaterialize,
  weeklyDisplayTarget,
  weeklyTargetHours,
} from "./volume";

const base = {
  raceDemandHours: null,
  ceilingHours: null,
  floorHours: null,
  availabilityHours: 12.5,
  fallbackHours: 10,
};

describe("weeklyTargetHours", () => {
  it("is a no-op without race demand — today's behaviour exactly", () => {
    // THE ROLLOUT SAFETY PROPERTY. Every existing plan must be untouched
    // until someone enters a distance.
    const r = weeklyTargetHours(base);
    expect(r.hours).toBe(10);
    expect(r.source).toBe("fallback");
    expect(r.shortfall).toBeNull();
  });

  it("uses race demand when it is known and under the ceiling", () => {
    const r = weeklyTargetHours({
      ...base,
      raceDemandHours: 11,
      ceilingHours: 11.6,
    });
    expect(r.hours).toBe(11);
    expect(r.source).toBe("race");
  });

  it("clamps race demand to the ceiling", () => {
    const r = weeklyTargetHours({
      ...base,
      raceDemandHours: 18,
      ceilingHours: 11.6,
    });
    expect(r.hours).toBe(11.6);
    expect(r.source).toBe("ceiling");
  });

  it("keeps source 'ceiling' through the availability clamp, not just when availability doesn't bind", () => {
    // Final-review Finding 3's own example: a low-peak athlete (ceiling
    // 3.13h) entering a demanding tour (56.35h demand) gets a ceiling-bound
    // target that availability ALSO caps. WeekRationale must be able to see
    // this came from the ceiling, not the race, or it prints a number that
    // visibly contradicts EventReadiness's demand figure on the same screen.
    const r = weeklyTargetHours({
      raceDemandHours: 56.35,
      ceilingHours: 3.13,
      floorHours: null,
      availabilityHours: 2,
      fallbackHours: 6,
    });
    expect(r.hours).toBe(2);
    expect(r.source).toBe("ceiling");
    expect(r.shortfall).toEqual({ wantedHours: 3.13, offeredHours: 2 });
  });

  it("SUPPRESSES race demand when there is no measured ceiling", () => {
    // A brand-new athlete who logs an alpine tour must not be handed ~11h/week
    // on no evidence. This is the largest injury risk in the design.
    const r = weeklyTargetHours({
      ...base,
      raceDemandHours: 11,
      ceilingHours: null,
    });
    expect(r.hours).toBe(10);
    expect(r.source).toBe("fallback");
  });

  it("floors a short event so it cannot prescribe a detraining week", () => {
    // A criterium demands ~2h. The athlete's peak is 8.9h, so the floor is
    // 5.3h. Prescribing 2h would actively cost them fitness.
    const r = weeklyTargetHours({
      ...base,
      raceDemandHours: 2.1,
      ceilingHours: 11.6,
      floorHours: 5.3,
      availabilityHours: 12.5,
    });
    expect(r.hours).toBeCloseTo(5.3, 5);
  });

  it("does not let the floor exceed the ceiling", () => {
    const r = weeklyTargetHours({
      ...base,
      raceDemandHours: 1,
      ceilingHours: 4,
      floorHours: 9,
      availabilityHours: 20,
    });
    expect(r.hours).toBeLessThanOrEqual(4);
    // A mislabelled source here would still pass the bound above while
    // feeding the wrong rationale text ("floor" instead of "ceiling") to the
    // athlete, so pin the label too.
    expect(r.source).toBe("ceiling");
  });

  it("leaves the target unchanged when the floor is already below it", () => {
    // Every other floor test sets floorHours ABOVE the target, so a
    // regression that dropped the `> target` guard — unconditionally setting
    // target = floorHours whenever it's non-null — would still pass all of
    // them. Here the floor (3) sits well below the race-driven target (8),
    // so it must be a no-op.
    const r = weeklyTargetHours({
      ...base,
      raceDemandHours: 8,
      ceilingHours: 11.6,
      floorHours: 3,
      availabilityHours: 12.5,
    });
    expect(r.hours).toBe(8);
    expect(r.source).toBe("race");
  });

  it("still caps at availability even when the floor is the binding constraint", () => {
    const r = weeklyTargetHours({
      ...base,
      raceDemandHours: 1,
      ceilingHours: 11.6,
      floorHours: 5.3,
      availabilityHours: 3,
    });
    expect(r.hours).toBe(3);
    // `source` names what the pre-clamp target (5.3, the shortfall's
    // wantedHours) actually IS — the maintenance floor — not that
    // availability capped it; `shortfall != null` already says that. See
    // Finding 3: a consumer like WeekRationale needs to know the number's
    // origin survives the clamp so it never attributes a floor- or
    // ceiling-derived figure to the race.
    expect(r.source).toBe("floor");
    expect(r.shortfall).toEqual({ wantedHours: 5.3, offeredHours: 3 });
  });

  it("caps at availability and reports the shortfall", () => {
    const r = weeklyTargetHours({
      raceDemandHours: 11,
      ceilingHours: 13,
      floorHours: null,
      availabilityHours: 7,
      fallbackHours: 10,
    });
    expect(r.hours).toBe(7);
    // Same as above: wantedHours (11) came from race demand, so `source`
    // stays "race" through the availability clamp instead of collapsing to
    // a fourth "availability" value.
    expect(r.source).toBe("race");
    expect(r.shortfall).toEqual({ wantedHours: 11, offeredHours: 7 });
  });

  it("leaves surplus availability unused", () => {
    // Availability is a ceiling, never a target. A free Saturday must not
    // override a recovery week.
    const r = weeklyTargetHours({
      raceDemandHours: 10,
      ceilingHours: 13,
      floorHours: null,
      availabilityHours: 20,
      fallbackHours: 8,
    });
    expect(r.hours).toBe(10);
    expect(r.shortfall).toBeNull();
  });

  it("never returns a negative or non-finite target", () => {
    const r = weeklyTargetHours({
      raceDemandHours: null,
      ceilingHours: null,
      floorHours: null,
      availabilityHours: -5,
      fallbackHours: 0,
    });
    expect(r.hours).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(r.hours)).toBe(true);
  });
});

describe("hoursForMaterialize", () => {
  // This is the exact call-site expression `rolloverWeekPlan` hands to
  // `materializeWeek`. It exists as a named export — rather than staying
  // inline — specifically so it can be pinned here; see the Task 9 finding
  // this guards: reverting it to `target.hours` left all 154 week-plan tests
  // passing.
  it("returns the pre-clamp wantedHours when availability binds", () => {
    const target = weeklyTargetHours({
      raceDemandHours: 11,
      ceilingHours: 13,
      floorHours: null,
      availabilityHours: 7,
      fallbackHours: 10,
    });
    // wantedHours (11) came from race demand; `source` keeps saying "race"
    // through the availability clamp rather than collapsing to a fourth
    // "availability" value — see Finding 3 in volume.ts's VolumeResult doc.
    expect(target.source).toBe("race");
    expect(target.shortfall).not.toBeNull();
    const hours = hoursForMaterialize(target);
    expect(hours).toBe(11);
    expect(hours).toBeGreaterThan(target.hours);
  });

  it("returns target.hours unchanged when availability does not bind", () => {
    const target = weeklyTargetHours({
      raceDemandHours: 11,
      ceilingHours: 13,
      floorHours: null,
      availabilityHours: 20,
      fallbackHours: 10,
    });
    expect(target.source).toBe("race");
    expect(target.shortfall).toBeNull();
    expect(hoursForMaterialize(target)).toBe(target.hours);
  });
});

describe("weeklyDisplayTarget", () => {
  // Pins the train-page Finding 1 regression: an earlier version of this
  // call site passed the week's own availability as `fallbackHours`, which
  // makes `availability < target` structurally impossible — the plan's real
  // hoursPerWeek target and the shortfall sentence both silently vanish. An
  // athlete with no race and no measured ceiling whose free weekend exceeds
  // their plan's hoursPerWeek must still see the PLAN's target, not their
  // calendar's availability, echoed back as if nothing needed explaining.
  it("uses the plan's hoursPerWeek, not availability, when there is no race and no ceiling", () => {
    const r = weeklyDisplayTarget({
      raceDemandHours: null,
      ceilingHours: null,
      floorHours: null,
      availabilityHours: 12,
      planHoursPerWeek: 8,
    });
    expect(r.hours).toBe(8);
    expect(r.source).toBe("fallback");
    expect(r.shortfall).toBeNull();
  });

  it("still reports a shortfall against the plan's hoursPerWeek when availability falls short", () => {
    const r = weeklyDisplayTarget({
      raceDemandHours: null,
      ceilingHours: null,
      floorHours: null,
      availabilityHours: 3,
      planHoursPerWeek: 8,
    });
    expect(r.hours).toBe(3);
    // The pre-existing-race-with-no-distance case from Finding 3: wantedHours
    // (8) is the plan's own hoursPerWeek, not a race demand — `source` must
    // say "fallback" through the clamp so a consumer never attributes this
    // number to a race.
    expect(r.source).toBe("fallback");
    expect(r.shortfall).toEqual({ wantedHours: 8, offeredHours: 3 });
  });
});
