import { describe, expect, it } from "vitest";
import { effectiveWeekLoad } from "./materialize";

const greens = Array(7).fill("green") as import("./types").Band[];
const suppressed = [
  "green",
  "amber",
  "red",
  "amber",
  "green",
  "amber",
  "green",
] as import("./types").Band[]; // 4 amber-or-worse

describe("effectiveWeekLoad (hand-computed fixtures)", () => {
  it("returns the skeleton target when last week went to plan", () => {
    const r = effectiveWeekLoad({
      skeletonTarget: 400,
      prevWeek: { actualLoad: 390, adherencePct: 98 },
      recentBands: greens,
    });
    expect(r.load).toBe(400);
    expect(r.reasons).toEqual([]);
  });

  it("builds on actual load, not the skeleton, below 70% adherence", () => {
    // actual 200 × 1.10 = 220; skeleton 400 ignored
    const r = effectiveWeekLoad({
      skeletonTarget: 400,
      prevWeek: { actualLoad: 200, adherencePct: 50 },
      recentBands: greens,
    });
    expect(r.load).toBe(220);
    expect(r.reasons.join(" ")).toContain("adherence");
  });

  it("does not fire the adherence rule at exactly 70%", () => {
    const r = effectiveWeekLoad({
      skeletonTarget: 300,
      prevWeek: { actualLoad: 250, adherencePct: 70 },
      recentBands: greens,
    });
    // only the ramp clamp applies: 250 × 1.2 = 300
    expect(r.load).toBe(300);
  });

  it("reduces 15% when ≥4 of the last 7 days were amber or worse", () => {
    // 400 × 0.85 = 340, then clamp vs actual 380: [304, 456] — 340 stands
    const r = effectiveWeekLoad({
      skeletonTarget: 400,
      prevWeek: { actualLoad: 380, adherencePct: 95 },
      recentBands: suppressed,
    });
    expect(r.load).toBe(340);
    expect(r.reasons.join(" ")).toContain("readiness");
  });

  it("does not reduce at 3 amber-or-worse days", () => {
    const bands = [
      "amber",
      "red",
      "amber",
      "green",
      "green",
      "green",
      "green",
    ] as import("./types").Band[];
    const r = effectiveWeekLoad({
      skeletonTarget: 400,
      prevWeek: { actualLoad: 390, adherencePct: 95 },
      recentBands: bands,
    });
    expect(r.load).toBe(400);
  });

  it("clamps the jump to +20% of previous actual (ramp guard)", () => {
    // skeleton 500 vs actual 300 → clamp to 360
    const r = effectiveWeekLoad({
      skeletonTarget: 500,
      prevWeek: { actualLoad: 300, adherencePct: 90 },
      recentBands: greens,
    });
    expect(r.load).toBe(360);
    expect(r.reasons.join(" ")).toContain("ramp");
  });

  it("clamps a drop to −20% of previous actual", () => {
    // suppressed: 300 × 0.85 = 255; clamp low = 320 × 0.8 = 256
    const r = effectiveWeekLoad({
      skeletonTarget: 300,
      prevWeek: { actualLoad: 320, adherencePct: 95 },
      recentBands: suppressed,
    });
    expect(r.load).toBe(256);
  });

  it("restarts a fully missed week at 60% of skeleton, not at 0", () => {
    // spec-gap rule: ±20% of 0 would freeze the plan at 0 forever
    const r = effectiveWeekLoad({
      skeletonTarget: 400,
      prevWeek: { actualLoad: 0, adherencePct: 0 },
      recentBands: greens,
    });
    expect(r.load).toBe(240);
    expect(r.reasons.join(" ")).toContain("missed");
  });

  it("uses the skeleton as-is for the very first week (no previous)", () => {
    const r = effectiveWeekLoad({
      skeletonTarget: 400,
      prevWeek: null,
      recentBands: [],
    });
    expect(r.load).toBe(400);
  });

  it("calibrating bands never count as amber-or-worse", () => {
    const bands = Array(7).fill("calibrating") as import("./types").Band[];
    const r = effectiveWeekLoad({
      skeletonTarget: 400,
      prevWeek: { actualLoad: 400, adherencePct: 100 },
      recentBands: bands,
    });
    expect(r.load).toBe(400);
  });
});
