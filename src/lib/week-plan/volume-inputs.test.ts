import { describe, expect, it } from "vitest";
import { longestSessionHoursOf } from "./volume-inputs";

describe("longestSessionHoursOf", () => {
  const act = (sport: string, hours: number, day: number) => ({
    provider: "intervals_icu",
    sport,
    startDate: new Date(2026, 6, day),
    durationS: hours * 3600,
  });

  it("ignores sessions outside the race's disciplines", () => {
    // F3b: before v0.46 this returned the longest activity of ANY kind, so a
    // triathlete's marathon readiness was answered by their longest bike ride.
    const longest = longestSessionHoursOf(
      [act("Ride", 6, 1), act("Run", 2, 2)],
      ["Run"]
    );
    expect(longest).toBe(2);
  });

  it("counts every discipline of a triathlon", () => {
    expect(
      longestSessionHoursOf(
        [act("Ride", 6, 1), act("Run", 2, 2), act("Swim", 1, 3)],
        ["Swim", "Bike", "Run"]
      )
    ).toBe(6);
  });

  it("canonicalises the provider's word before comparing", () => {
    // "Bike".includes("Ride") is false for every cyclist who has ever used
    // this app — the mistake plan-sport.ts:166-173 already warns about.
    expect(longestSessionHoursOf([act("Ride", 6, 1)], ["Bike"])).toBe(6);
  });

  it("returns null when no session matches, rather than zero", () => {
    expect(longestSessionHoursOf([act("Ride", 6, 1)], ["Run"])).toBeNull();
  });
});
