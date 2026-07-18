import { describe, expect, it } from "vitest";
import { calibrationProgress, CALIBRATION_TARGET_DAYS } from "./calibration";

function days(n: number, signal = true) {
  return Array.from({ length: n }, () => ({
    hrvMs: signal ? 60 : null,
    restingHr: null,
  }));
}

describe("calibrationProgress", () => {
  it("counts only days with a usable signal", () => {
    const mixed = [
      { hrvMs: 60, restingHr: null },
      { hrvMs: null, restingHr: 48 },
      { hrvMs: null, restingHr: null }, // no signal — doesn't count
      { hrvMs: 0, restingHr: 0 }, // zeros aren't signal
    ];
    const p = calibrationProgress(mixed);
    expect(p.daysWithSignal).toBe(2);
    expect(p.remaining).toBe(CALIBRATION_TARGET_DAYS - 2);
  });

  it("caps progress at the target and reports completion", () => {
    const p = calibrationProgress(days(CALIBRATION_TARGET_DAYS + 5));
    expect(p.daysWithSignal).toBe(CALIBRATION_TARGET_DAYS);
    expect(p.remaining).toBe(0);
    expect(p.prompt).toMatch(/complete/i);
  });

  it("prompts to start when there is no signal yet", () => {
    const p = calibrationProgress(days(3, false));
    expect(p.daysWithSignal).toBe(0);
    expect(p.remaining).toBe(CALIBRATION_TARGET_DAYS);
    expect(p.prompt).toMatch(/first morning/i);
  });

  it("gives an almost-there prompt in the final week", () => {
    const p = calibrationProgress(days(CALIBRATION_TARGET_DAYS - 1));
    expect(p.remaining).toBe(1);
    expect(p.prompt).toMatch(/1 more day\b/);
  });
});
