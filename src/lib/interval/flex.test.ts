import { describe, it, expect } from "vitest";
import { flexRef, flexSpanSecs, FLEX_FRACTION, FLEX_FLOOR_SECS } from "./flex";
import type { Block, LibraryWorkout } from "./types";

const W = (secs: number, lo: number, hi: number) => ({ secs, lo, hi });

const wk = (blocks: Block[]): LibraryWorkout => ({
  id: "x",
  name: "x",
  purpose: "threshold",
  family: "f",
  why: "w",
  source: "Invented. Confidence: Low.",
  blocks,
});

const SS: Block[] = [
  { name: "Warmup", repeat: 1, steps: [W(900, 50, 65)] },
  { name: "Main set", repeat: 3, steps: [W(720, 88, 93), W(300, 55, 55)] },
  { name: "Cooldown", repeat: 1, steps: [W(540, 50, 50)] },
];

describe("flexRef", () => {
  it("picks the longest step in a repeat-1 block", () => {
    expect(flexRef(SS)).toEqual({ b: 0, s: 0 });
  });

  it("never picks a step inside a repeat, however long", () => {
    // The 720s main-set step is longer than the 600s warmup, but the main set
    // is what the workout IS and must not be stretched.
    const b: Block[] = [
      { name: "Warmup", repeat: 1, steps: [W(600, 50, 65)] },
      { name: "Main set", repeat: 3, steps: [W(720, 88, 93)] },
    ];
    expect(flexRef(b)).toEqual({ b: 0, s: 0 });
  });

  it("breaks ties on the LAST step, putting a cooldown ahead of an equal warmup", () => {
    const b: Block[] = [
      { name: "Warmup", repeat: 1, steps: [W(600, 50, 50)] },
      { name: "Cooldown", repeat: 1, steps: [W(600, 50, 50)] },
    ];
    expect(flexRef(b)).toEqual({ b: 1, s: 0 });
  });

  it("returns null when every block repeats", () => {
    // Nothing to flex: this workout can never be a candidate. Slice 2's guard
    // is where that becomes an authoring error rather than a silent absence.
    expect(
      flexRef([{ name: "Main set", repeat: 5, steps: [W(240, 110, 110)] }])
    ).toBeNull();
  });
});

describe("flexSpanSecs", () => {
  it("spans the fixed remainder plus the flex step's bounds", () => {
    // fixed = 4500 - 900 = 3600. flex 900 -> lo 450, hi 1350.
    expect(flexSpanSecs(wk(SS))).toEqual({ lo: 4050, hi: 4950 });
  });

  it("floors a short flex step at its authored length, not below", () => {
    // A 200s step is already under FLEX_FLOOR_SECS. Math.min keeps it
    // resolvable at 200 rather than making it unmatchable outright.
    const short: Block[] = [
      { name: "Warmup", repeat: 1, steps: [W(200, 50, 50)] },
      { name: "Main set", repeat: 2, steps: [W(600, 90, 90)] },
    ];
    expect(flexSpanSecs(wk(short))).toEqual({ lo: 1400, hi: 1500 });
  });

  it("is null for a workout with nothing to flex", () => {
    expect(
      flexSpanSecs(wk([{ name: "Main", repeat: 5, steps: [W(240, 110, 110)] }]))
    ).toBeNull();
  });

  it("keeps the tolerance constants where the spec put them", () => {
    expect(FLEX_FRACTION).toBe(0.5);
    expect(FLEX_FLOOR_SECS).toBe(300);
  });
});
