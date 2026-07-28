import { describe, expect, it } from "vitest";
import { weeklyTargetHours } from "./volume";

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
