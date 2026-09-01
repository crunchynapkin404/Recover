import { describe, it, expect } from "vitest";
import { renderProfile } from "./render-profile";
import type { Block } from "./types";

const SS: Block[] = [
  {
    name: "Warmup",
    repeat: 1,
    steps: [{ secs: 600, lo: 50, hi: 65, ramp: true }],
  },
  {
    name: "Main set",
    repeat: 3,
    steps: [
      { secs: 720, lo: 88, hi: 93 },
      { secs: 300, lo: 55, hi: 55 },
    ],
  },
  { name: "Cooldown", repeat: 1, steps: [{ secs: 540, lo: 50, hi: 50 }] },
];

describe("renderProfile", () => {
  it("unrolls repeats into one bar per rendered step", () => {
    // 1 warmup + 3 x 2 main + 1 cooldown = 8 bars, the same count renderZwo
    // emits. A repeat drawn once would show a 75-minute workout as 25.
    expect(renderProfile(SS)).toHaveLength(8);
  });

  it("lays bars end to end across the full width, with no gaps", () => {
    const bars = renderProfile(SS);
    expect(bars[0].x).toBe(0);
    for (let i = 1; i < bars.length; i++) {
      expect(bars[i].x).toBeCloseTo(bars[i - 1].x + bars[i - 1].w, 10);
    }
    const last = bars[bars.length - 1];
    expect(last.x + last.w).toBeCloseTo(1, 10);
  });

  it("gives each bar a width proportional to its share of the workout", () => {
    const bars = renderProfile(SS);
    // This fixture totals 600 + 3 x 1020 + 540 = 4200s.
    expect(bars[0].w).toBeCloseTo(600 / 4200, 10);
    expect(bars[1].w).toBeCloseTo(720 / 4200, 10);
  });

  it("carries the target band and the ramp flag through", () => {
    const bars = renderProfile(SS);
    expect(bars[0]).toMatchObject({ lo: 50, hi: 65, ramp: true });
    expect(bars[1]).toMatchObject({ lo: 88, hi: 93 });
    expect(bars[1].ramp).toBeUndefined();
  });

  it("is empty for no blocks rather than throwing", () => {
    expect(renderProfile([])).toEqual([]);
    expect(renderProfile([{ name: "X", repeat: 1, steps: [] }])).toEqual([]);
  });

  it("never divides by zero when every step is zero-length", () => {
    // Not a real workout, but a guard against a NaN reaching an SVG attribute,
    // which renders as a silently invisible chart rather than an error.
    const bars = renderProfile([
      { name: "X", repeat: 1, steps: [{ secs: 0, lo: 50, hi: 50 }] },
    ]);
    for (const b of bars) {
      expect(Number.isFinite(b.x)).toBe(true);
      expect(Number.isFinite(b.w)).toBe(true);
    }
  });
});
