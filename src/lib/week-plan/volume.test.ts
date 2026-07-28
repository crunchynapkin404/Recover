import { describe, expect, it } from "vitest";
import { hoursForMaterialize, weeklyTargetHours } from "./volume";

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
    expect(r.source).toBe("availability");
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
    expect(r.source).toBe("availability");
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
    expect(target.source).toBe("availability");
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
