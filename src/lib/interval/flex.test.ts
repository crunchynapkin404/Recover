import { describe, it, expect } from "vitest";
import {
  flexRef,
  flexSpanSecs,
  resolve,
  FLEX_FRACTION,
  FLEX_FLOOR_SECS,
} from "./flex";
import { totalSecs } from "./duration";

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

describe("resolve", () => {
  it("hits the requested duration EXACTLY", () => {
    const blocks = resolve(wk(SS), 70);
    expect(blocks).not.toBeNull();
    expect(totalSecs(blocks!)).toBe(4200);
  });

  it("moves only the flex step and leaves the main set alone", () => {
    const blocks = resolve(wk(SS), 70)!;
    expect(blocks[0].steps[0].secs).toBe(600); // warmup absorbed -300
    expect(blocks[1]).toEqual(SS[1]); // main set untouched, same shape
    expect(blocks[2]).toEqual(SS[2]); // cooldown untouched
  });

  it("refuses a length outside the flex step's bounds", () => {
    // SS spans 4050-4950s, i.e. 67.5-82.5 min.
    expect(resolve(wk(SS), 60)).toBeNull();
    expect(resolve(wk(SS), 90)).toBeNull();
  });

  it("refuses a workout with nothing to flex", () => {
    expect(
      resolve(wk([{ name: "Main", repeat: 5, steps: [W(240, 110, 110)] }]), 40)
    ).toBeNull();
  });

  it("hits every whole minute across its own span, exactly", () => {
    // The guarantee the spec states, swept rather than sampled: a rounding
    // slip of one second at some awkward length would not show in an example.
    const span = flexSpanSecs(wk(SS))!;
    let checked = 0;
    for (let secs = span.lo; secs <= span.hi; secs++) {
      if (secs % 60 !== 0) continue;
      const mins = secs / 60;
      const blocks = resolve(wk(SS), mins);
      expect(blocks, `refused ${mins} min inside its own span`).not.toBeNull();
      expect(totalSecs(blocks!)).toBe(Math.round(mins * 60));
      checked++;
    }
    expect(checked).toBeGreaterThan(10);
  });

  it("does not mutate the workout it was given", () => {
    const w = wk(SS);
    const before = JSON.stringify(w);
    resolve(w, 70);
    expect(JSON.stringify(w)).toBe(before);
  });
});
