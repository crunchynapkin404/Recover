import { describe, expect, it } from "vitest";
import { canonicalSport } from "./canonical-sport";
import {
  PLAN_SPORTS,
  disciplinesOf,
  inferPlanSport,
  requirePlanSport,
  toPlanSport,
} from "./plan-sport";

describe("toPlanSport", () => {
  it("accepts the planner's own vocabulary", () => {
    expect(toPlanSport("Bike")).toBe("Bike");
    expect(toPlanSport("Run")).toBe("Run");
    expect(toPlanSport("Triathlon")).toBe("Triathlon");
  });

  it("canonicalises every provider word for cycling", () => {
    // The exact bug: the coach wrote the provider's word and the planner
    // silently produced running.
    for (const raw of [
      "Ride",
      "VirtualRide",
      "GravelRide",
      "cycling",
      "ride",
    ]) {
      expect(toPlanSport(raw)).toBe("Bike");
    }
  });

  it("canonicalises provider words for running", () => {
    for (const raw of ["Run", "TrailRun", "VirtualRun", "running"]) {
      expect(toPlanSport(raw)).toBe("Run");
    }
  });

  it("recognises triathlon by its own names", () => {
    for (const raw of ["Triathlon", "triathlon", "TRIATHLON"]) {
      expect(toPlanSport(raw)).toBe("Triathlon");
    }
  });

  it("returns null rather than guessing", () => {
    // Swim is the important one: it is a real discipline the generator
    // cannot build a plan for, so it must NOT resolve to Run.
    for (const raw of ["Swim", "OpenWaterSwim", "Tennis", "Walk", "", null]) {
      expect(toPlanSport(raw)).toBeNull();
    }
  });
});

describe("inferPlanSport", () => {
  it("places every value of the closed 13-value raceType enum", () => {
    // This is the completeness guarantee an exact lookup gives that a
    // heuristic never could: every enum value is asserted, not sampled.
    const cases: Record<string, "Bike" | "Run" | "Triathlon" | null> = {
      marathon: "Run",
      half_marathon: "Run",
      "10k": "Run",
      "5k": "Run",
      ultra: "Run",
      ironman: "Triathlon",
      "70.3": "Triathlon",
      olympic_tri: "Triathlon",
      sprint_tri: "Triathlon",
      gran_fondo: "Bike",
      century: "Bike",
      crit: "Bike",
      // Names no sport — must NOT be guessed at.
      general_fitness: null,
    };
    for (const [raceType, expected] of Object.entries(cases)) {
      expect(inferPlanSport(raceType)).toBe(expected);
    }
  });

  it("places the live free-text spelling and its separator variants", () => {
    // races.race_type is free text; the live row reads "GranFondo".
    expect(inferPlanSport("GranFondo")).toBe("Bike");
    expect(inferPlanSport("gran fondo")).toBe("Bike");
    expect(inferPlanSport("gran_fondo")).toBe("Bike");
  });

  it("places a modest set of additional real-world spellings", () => {
    expect(inferPlanSport("criterium")).toBe("Bike");
    expect(inferPlanSport("ultramarathon")).toBe("Run");
    expect(inferPlanSport("half ironman")).toBe("Triathlon");
    expect(inferPlanSport("triathlon")).toBe("Triathlon");
    expect(inferPlanSport("parkrun")).toBe("Run");
  });

  it("returns null for unrecognised free text", () => {
    expect(inferPlanSport("")).toBeNull();
    expect(inferPlanSport("Tennis")).toBeNull();
  });

  describe("the three historical defects, as regression tests", () => {
    it('does not read "tri" inside "trial" as a triathlon (round 1)', () => {
      expect(inferPlanSport("time trial")).toBeNull();
    });

    it("does not read a swim event as Run or Bike from a distance/format needle (round 3)", () => {
      // "10k open water swim" is the exact defect this release exists to
      // remove: the "10k" needle matched and returned Run. An exact
      // lookup never sees the substring, so it cannot happen again.
      // "10k marathon swim" is a real Olympic event — Swim is deliberately
      // not a plan sport, so the honest answer for all of these is null.
      expect(inferPlanSport("10k open water swim")).toBeNull();
      expect(inferPlanSport("5k swim")).toBeNull();
      expect(inferPlanSport("half mile open water swim")).toBeNull();
      expect(inferPlanSport("ultra distance swim")).toBeNull();
      expect(inferPlanSport("swimrun")).toBeNull();
      expect(inferPlanSport("aquathlon")).toBeNull();
    });
  });

  it("returns null for the round-2 compound words — a deliberate behaviour change", () => {
    // Round 2 added word-boundary regexes so these fused compounds would
    // match Bike/Run. An exact lookup does not do substring matching at
    // all, so none of these are recognised any more. That is intended:
    // they are unrecognised free text, the athlete picks in the dropdown,
    // and null is a safe answer there. Do NOT "fix" this by restoring
    // substring/regex matching — that is the exact machinery this release
    // removed, and it is what produced all three historical defects above.
    expect(inferPlanSport("bikepacking")).toBeNull();
    expect(inferPlanSport("mountainbike")).toBeNull();
    expect(inferPlanSport("ultratrail")).toBeNull();
    expect(inferPlanSport("trail running")).toBeNull();
  });
});

describe("requirePlanSport", () => {
  it("returns the sport when placeable", () => {
    expect(requirePlanSport("Ride")).toBe("Bike");
  });

  it("throws, naming the value, when not", () => {
    expect(() => requirePlanSport("Swim")).toThrow(/Swim/);
    expect(() => requirePlanSport(null)).toThrow();
  });
});

describe("PLAN_SPORTS", () => {
  it("is exactly what the generator can build", () => {
    expect([...PLAN_SPORTS]).toEqual(["Bike", "Run", "Triathlon"]);
  });
});

describe("disciplinesOf", () => {
  it("gives a single-discipline sport just itself", () => {
    expect([...disciplinesOf("Bike")]).toEqual(["Bike"]);
    expect([...disciplinesOf("Run")]).toEqual(["Run"]);
  });

  it("gives triathlon all three", () => {
    expect([...disciplinesOf("Triathlon")].sort()).toEqual([
      "Bike",
      "Run",
      "Swim",
    ]);
  });

  it("admits a provider-worded activity once canonicalised", () => {
    // F12: race/debrief.ts compared ["Bike"] to the raw "Ride" and so never
    // matched a cyclist's own race. The pairing below is the fix.
    const admitted = disciplinesOf("Bike") as readonly string[];
    expect(admitted.includes(canonicalSport("Ride"))).toBe(true);
    expect(admitted.includes(canonicalSport("Run"))).toBe(false);
  });
});
