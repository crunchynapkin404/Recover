import { describe, it, expect } from "vitest";
import { totalSecs } from "./duration";
import type { Block } from "./types";

const SS_3X12: Block[] = [
  {
    name: "Warmup",
    repeat: 1,
    steps: [
      { secs: 600, lo: 50, hi: 65, ramp: true },
      { secs: 180, lo: 75, hi: 75 },
      { secs: 120, lo: 55, hi: 55 },
    ],
  },
  {
    name: "Main set",
    repeat: 3,
    steps: [
      { secs: 720, lo: 88, hi: 93, rpm: 90 },
      { secs: 300, lo: 55, hi: 55 },
    ],
  },
  { name: "Cooldown", repeat: 1, steps: [{ secs: 540, lo: 50, hi: 50 }] },
];

describe("totalSecs", () => {
  it("counts every repetition of a repeated block", () => {
    // 900 warmup + 3 x 1020 main + 540 cooldown = 4500s = 75 min exactly.
    expect(totalSecs(SS_3X12)).toBe(4500);
  });

  it("is zero for no blocks", () => {
    expect(totalSecs([])).toBe(0);
  });

  it("treats repeat: 1 as a plain section", () => {
    expect(
      totalSecs([
        { name: "X", repeat: 1, steps: [{ secs: 60, lo: 50, hi: 50 }] },
      ])
    ).toBe(60);
  });
});
