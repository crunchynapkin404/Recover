import { describe, expect, it } from "vitest";
import { resolveComebackDecision } from "./comeback";

const green7 = [
  "green",
  "green",
  "green",
  "green",
  "green",
  "green",
  "green",
] as const;

describe("resolveComebackDecision", () => {
  it("is inactive when no illness and no suppressed-load disruption entry", () => {
    const out = resolveComebackDecision({
      recentBands: [...green7],
      recentIllFlags: Array(7).fill(false),
      recentLoadDisruption: false,
    });
    expect(out.mode).toBe("none");
    expect(out.loadCapMultiplier).toBe(1);
  });

  it("enters strict mode when illness appears in trailing week", () => {
    const out = resolveComebackDecision({
      recentBands: ["green", "green", "green", "green", "green", "green", "amber"],
      recentIllFlags: [false, false, true, false, false, false, false],
      recentLoadDisruption: false,
    });
    expect(out.mode).toBe("strict");
    expect(out.loadCapMultiplier).toBe(0.7);
    expect(out.maxIntensity).toBe("tempo");
  });

  it("uses suppressed+load disruption as comeback entry", () => {
    const out = resolveComebackDecision({
      recentBands: ["green", "green", "green", "green", "green", "green", "red"],
      recentIllFlags: Array(7).fill(false),
      recentLoadDisruption: true,
    });
    expect(out.mode).toBe("strict");
  });

  it("steps up to 85% after two stable days", () => {
    const out = resolveComebackDecision({
      recentBands: ["red", "amber", "green", "green", "green", "green", "green"],
      recentIllFlags: [true, false, false, false, false, false, false],
      recentLoadDisruption: false,
    });
    expect(out.mode).toBe("step_up");
    expect(out.loadCapMultiplier).toBe(0.85);
  });
});
