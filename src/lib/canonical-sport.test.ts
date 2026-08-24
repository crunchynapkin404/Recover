import { describe, expect, it } from "vitest";
import {
  canonicalSport,
  providerSportAliases,
  sportMatches,
} from "./canonical-sport";

describe("canonicalSport", () => {
  it("maps every cycling discipline onto the plan's 'Bike'", () => {
    // Live data at the time of writing: Ride 177, VirtualRide 42.
    for (const raw of [
      "Ride",
      "VirtualRide",
      "GravelRide",
      "MountainBikeRide",
      "EBikeRide",
      "Handcycle",
      "Velomobile",
    ]) {
      expect(canonicalSport(raw)).toBe("Bike");
    }
  });

  it("maps running disciplines onto 'Run'", () => {
    for (const raw of ["Run", "VirtualRun", "TrailRun"]) {
      expect(canonicalSport(raw)).toBe("Run");
    }
  });

  it("maps swimming disciplines onto 'Swim'", () => {
    for (const raw of ["Swim", "OpenWaterSwim"]) {
      expect(canonicalSport(raw)).toBe("Swim");
    }
  });

  it("is identity on the plan's own vocabulary", () => {
    // generateWorkouts emits exactly these; canonicalising a planned sport
    // must never change it, or the matcher would compare two moving targets.
    expect(canonicalSport("Bike")).toBe("Bike");
    expect(canonicalSport("Run")).toBe("Run");
    expect(canonicalSport("Swim")).toBe("Swim");
  });

  it("is case-insensitive and whitespace-tolerant", () => {
    expect(canonicalSport("ride")).toBe("Bike");
    expect(canonicalSport("  VIRTUALRIDE  ")).toBe("Bike");
  });

  it("passes unknown sports through unchanged rather than guessing", () => {
    // Live data also holds Workout, Walk, Tennis. Mapping those onto a
    // training sport would book a tennis match as a planned ride.
    expect(canonicalSport("Tennis")).toBe("Tennis");
    expect(canonicalSport("Walk")).toBe("Walk");
    expect(canonicalSport("Workout")).toBe("Workout");
  });

  it("handles null/empty without throwing", () => {
    expect(canonicalSport("")).toBe("");
    expect(canonicalSport(null)).toBe("");
    expect(canonicalSport(undefined)).toBe("");
  });
});

describe("sportMatches", () => {
  it("matches a planned Bike session to a Ride — THE BUG", () => {
    // service.ts compared these with eq(): "Bike" never equalled "Ride", so
    // across 219 live rides not one planned cycling session ever completed.
    // Every week then closed as "fully missed" and effectiveWeekLoad
    // restarted at 60% of skeleton, every single week.
    expect(sportMatches("Bike", "Ride")).toBe(true);
    expect(sportMatches("Bike", "VirtualRide")).toBe(true);
  });

  it("still matches the cases that already worked", () => {
    expect(sportMatches("Run", "Run")).toBe(true);
    expect(sportMatches("Swim", "Swim")).toBe(true);
  });

  it("does not match across disciplines", () => {
    expect(sportMatches("Bike", "Run")).toBe(false);
    expect(sportMatches("Run", "Ride")).toBe(false);
    expect(sportMatches("Bike", "Tennis")).toBe(false);
    expect(sportMatches("Bike", "Walk")).toBe(false);
  });

  it("does not match when either side is missing", () => {
    expect(sportMatches("Bike", null)).toBe(false);
    expect(sportMatches("", "Ride")).toBe(false);
  });
});

describe("providerSportAliases", () => {
  // The matcher runs in SQL, so it cannot call sportMatches per row. It
  // filters on a lower-cased alias list instead; these must stay in step.
  it("lists every lower-cased discipline that counts as the planned sport", () => {
    const bike = providerSportAliases("Bike");
    expect(bike).toContain("ride");
    expect(bike).toContain("virtualride");
    expect(bike).toContain("bike");
    expect(bike).not.toContain("run");
  });

  it("agrees with sportMatches for every alias it returns", () => {
    for (const planned of ["Bike", "Run", "Swim"]) {
      for (const alias of providerSportAliases(planned)) {
        expect(sportMatches(planned, alias)).toBe(true);
      }
    }
  });

  it("falls back to the sport itself when nothing maps to it", () => {
    expect(providerSportAliases("Tennis")).toEqual(["tennis"]);
  });

  it("returns nothing for a missing sport, so SQL matches no rows", () => {
    expect(providerSportAliases("")).toEqual([]);
    expect(providerSportAliases(null)).toEqual([]);
  });
});

describe("strength", () => {
  it("maps WeightTraining to Strength", () => {
    expect(canonicalSport("WeightTraining")).toBe("Strength");
    expect(canonicalSport("weighttraining")).toBe("Strength");
  });

  it("completes a planned strength session", () => {
    expect(sportMatches("Strength", "WeightTraining")).toBe(true);
  });

  it("does not claim Strava's generic Workout as strength", () => {
    // "Workout" is Strava's catch-all for anything it cannot classify.
    // Claiming all of it as lifting would book yoga, tennis and rowing as
    // strength sessions. Unmapped is the honest outcome, exactly as this
    // module's own doc comment argues for Tennis.
    expect(canonicalSport("Workout")).toBe("Workout");
    expect(sportMatches("Strength", "Workout")).toBe(false);
  });

  it("never completes an endurance session with a lift", () => {
    expect(sportMatches("Bike", "WeightTraining")).toBe(false);
    expect(sportMatches("Run", "WeightTraining")).toBe(false);
  });

  it("lists its provider aliases for the SQL filter", () => {
    expect(providerSportAliases("Strength")).toContain("weighttraining");
  });
});
