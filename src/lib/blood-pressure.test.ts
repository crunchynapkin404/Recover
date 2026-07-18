import { describe, expect, it } from "vitest";
import { classifyBp, bpTrend, MIN_BP_READINGS } from "./blood-pressure";

describe("classifyBp", () => {
  it("classifies each band by the more severe of systolic/diastolic", () => {
    expect(classifyBp(115, 75)?.category).toBe("normal");
    expect(classifyBp(125, 78)?.category).toBe("elevated"); // systolic elevated
    expect(classifyBp(128, 82)?.category).toBe("stage1"); // diastolic wins
    expect(classifyBp(135, 75)?.category).toBe("stage1"); // systolic
    expect(classifyBp(145, 85)?.category).toBe("stage2");
    expect(classifyBp(120, 92)?.category).toBe("stage2"); // diastolic wins
    expect(classifyBp(185, 100)?.category).toBe("crisis");
    expect(classifyBp(150, 125)?.category).toBe("crisis"); // diastolic crisis
  });

  it("returns null on missing or nonsensical input", () => {
    expect(classifyBp(null, 80)).toBeNull();
    expect(classifyBp(120, null)).toBeNull();
    expect(classifyBp(0, 80)).toBeNull();
  });

  it("carries a human label", () => {
    expect(classifyBp(145, 85)?.label).toBe("Stage 2 hypertension");
  });
});

describe("bpTrend", () => {
  function reading(date: string, s: number, d: number) {
    return { date, systolic: s, diastolic: d };
  }

  it("null below the minimum readings", () => {
    const readings = Array.from({ length: MIN_BP_READINGS - 1 }, (_, i) =>
      reading(`2026-07-0${i + 1}`, 120, 78)
    );
    expect(bpTrend(readings)).toBeNull();
  });

  it("averages and reports the latest classification", () => {
    const t = bpTrend([
      reading("2026-07-01", 120, 80),
      reading("2026-07-02", 122, 78),
      reading("2026-07-03", 118, 76),
    ])!;
    expect(t.readings).toBe(3);
    expect(t.avgSystolic).toBe(120);
    expect(t.latest.systolic).toBe(118);
  });

  it("detects a rising trend beyond the deadband", () => {
    const t = bpTrend([
      reading("2026-07-01", 118, 76),
      reading("2026-07-02", 120, 78),
      reading("2026-07-03", 132, 84),
      reading("2026-07-04", 135, 86),
    ])!;
    expect(t.direction).toBe("rising");
  });

  it("reads small changes as steady", () => {
    const t = bpTrend([
      reading("2026-07-01", 120, 80),
      reading("2026-07-02", 121, 79),
      reading("2026-07-03", 119, 80),
      reading("2026-07-04", 120, 80),
    ])!;
    expect(t.direction).toBe("steady");
  });

  it("ignores readings missing a number", () => {
    const t = bpTrend([
      reading("2026-07-01", 120, 80),
      { date: "2026-07-02", systolic: null, diastolic: 80 },
      reading("2026-07-03", 122, 78),
      reading("2026-07-04", 118, 76),
    ])!;
    expect(t.readings).toBe(3);
  });
});
