import { describe, expect, it } from "vitest";
import {
  applyOpeningWorkoutRules,
  resolveFormBucket,
  resolveOpeningDecision,
} from "./start-branching";

describe("resolveFormBucket", () => {
  it("treats -20 as deep negative", () => {
    expect(resolveFormBucket(-20)).toBe("deep_negative");
  });

  it("treats values above -20 through -10 as moderate", () => {
    expect(resolveFormBucket(-19.9)).toBe("moderate_negative");
    expect(resolveFormBucket(-10)).toBe("moderate_negative");
  });

  it("treats values above -10 as neutral-positive", () => {
    expect(resolveFormBucket(-9.9)).toBe("neutral_positive");
    expect(resolveFormBucket(5)).toBe("neutral_positive");
  });
});

describe("resolveOpeningDecision", () => {
  it("maps deep negative to recovery-first", () => {
    const out = resolveOpeningDecision(-21);
    expect(out.branch).toBe("recovery_first");
    expect(out.loadMultiplier).toBe(0.8);
  });

  it("maps moderate negative to reduced build", () => {
    const out = resolveOpeningDecision(-15);
    expect(out.branch).toBe("reduced_build");
    expect(out.loadMultiplier).toBe(0.9);
  });

  it("maps null to normal build", () => {
    const out = resolveOpeningDecision(null);
    expect(out.branch).toBe("normal_build");
    expect(out.loadMultiplier).toBe(1);
  });
});

describe("applyOpeningWorkoutRules", () => {
  const base = [
    {
      day: 0,
      type: "Intervals",
      intensity: "Z4-Z5",
      description: "Hard session",
    },
    {
      day: 1,
      type: "Tempo",
      intensity: "Z3",
      description: "Tempo session",
    },
    {
      day: 2,
      type: "Endurance",
      intensity: "Z1-Z2",
      description: "Easy session",
    },
    {
      day: 3,
      type: "Intervals",
      intensity: "Z4-Z5",
      description: "Day 4 quality",
    },
  ];

  it("downgrades first 72h intensity for reduced build", () => {
    const out = applyOpeningWorkoutRules(base, "reduced_build");
    expect(out[0].type).toBe("Endurance");
    expect(out[1].type).toBe("Endurance");
    expect(out[2].type).toBe("Endurance");
    expect(out[3].type).toBe("Intervals");
  });

  it("forces recovery-first behavior on first 72h", () => {
    const out = applyOpeningWorkoutRules(base, "recovery_first");
    expect(out[0].type).toBe("Recovery");
    expect(out[1].type).toBe("Recovery");
    expect(out[2].type).toBe("Endurance");
    expect(out[0].intensity).toBe("Recovery");
    expect(out[3].type).toBe("Intervals");
  });
});
