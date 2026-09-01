import { describe, it, expect } from "vitest";
import { isPinStale, type WorkoutPin } from "./pin";

const pin: WorkoutPin = {
  workoutId: "thr-4x8",
  exportedAt: "2026-09-01T07:00:00.000Z",
  purpose: "threshold",
  durationMins: 75,
};

describe("isPinStale", () => {
  it("is fresh while the session is what it was at export", () => {
    expect(isPinStale(pin, { purpose: "threshold", durationMins: 75 })).toBe(
      false
    );
  });

  it("is stale when the day got shorter or longer", () => {
    // Red readiness scales an endurance day; redistribution lengthens one.
    expect(isPinStale(pin, { purpose: "threshold", durationMins: 53 })).toBe(
      true
    );
    expect(isPinStale(pin, { purpose: "threshold", durationMins: 94 })).toBe(
      true
    );
  });

  it("is stale when the day changed purpose", () => {
    // Amber steps Tempo down to Endurance, which re-derives the purpose.
    expect(isPinStale(pin, { purpose: "aerobic_base", durationMins: 75 })).toBe(
      true
    );
  });

  it("compares only the session it was taken from", () => {
    // The whole reason the pin stores four fields rather than two: staleness
    // must not depend on the library, on neighbouring days, or on anything
    // that would mark a day stale when nothing happened to it.
    const a = isPinStale(pin, { purpose: "threshold", durationMins: 75 });
    const b = isPinStale(pin, { purpose: "threshold", durationMins: 75 });
    expect(a).toBe(b);
    expect(a).toBe(false);
  });

  it("treats a missing pin as nothing to be stale about", () => {
    expect(
      isPinStale(undefined, { purpose: "threshold", durationMins: 75 })
    ).toBe(false);
  });
});
