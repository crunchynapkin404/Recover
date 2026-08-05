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
  it("places every raceType the plan tool can emit", () => {
    const cases: Record<string, "Bike" | "Run" | "Triathlon"> = {
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
    };
    for (const [raceType, expected] of Object.entries(cases)) {
      expect(inferPlanSport(raceType)).toBe(expected);
    }
  });

  it("places the free-text spellings the race form accepts", () => {
    // races.race_type is free text; the live row reads "GranFondo".
    expect(inferPlanSport("GranFondo")).toBe("Bike");
    expect(inferPlanSport("gran fondo")).toBe("Bike");
    expect(inferPlanSport("Half Marathon")).toBe("Run");
  });

  it("returns null for a race type it cannot place", () => {
    // general_fitness names no sport, and neither does a typo.
    expect(inferPlanSport("general_fitness")).toBeNull();
    expect(inferPlanSport("swimrun")).toBeNull();
    expect(inferPlanSport("")).toBeNull();
  });

  it("does not read 'tri' inside 'trial' as a triathlon", () => {
    // "time trial" is a cycling format, but it is genuinely ambiguous
    // (running time trials exist too) — refusing beats guessing.
    expect(inferPlanSport("time trial")).toBeNull();
    expect(inferPlanSport("hill climb time trial")).toBeNull();
  });

  it("still recognises 'tri' as a whole word, any separator", () => {
    expect(inferPlanSport("olympic_tri")).toBe("Triathlon");
    expect(inferPlanSport("sprint_tri")).toBe("Triathlon");
    expect(inferPlanSport("olympic tri")).toBe("Triathlon");
    expect(inferPlanSport("half ironman")).toBe("Triathlon");
    expect(inferPlanSport("ironman 70.3")).toBe("Triathlon");
  });

  it("places run-branch collisions correctly", () => {
    expect(inferPlanSport("parkrun")).toBe("Run");
    expect(inferPlanSport("trail run")).toBe("Run");
    expect(inferPlanSport("10k run")).toBe("Run");
    expect(inferPlanSport("half marathon")).toBe("Run");
  });

  it("keeps multi-sport disciplines this app cannot plan for at null", () => {
    expect(inferPlanSport("swimrun")).toBeNull();
    expect(inferPlanSport("aquathlon")).toBeNull();
  });

  it("matches 'crit' as a word start without breaking 'criterium'", () => {
    expect(inferPlanSport("crit")).toBe("Bike");
    expect(inferPlanSport("criterium")).toBe("Bike");
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
