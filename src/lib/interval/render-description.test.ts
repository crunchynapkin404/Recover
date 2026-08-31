import { describe, it, expect } from "vitest";
import { renderDescription } from "./render-description";
import type { Block, Step } from "./types";

describe("renderDescription", () => {
  it("describes the main set of a repeated workout", () => {
    const b: Block[] = [
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
    expect(renderDescription(b)).toBe(
      "3 × 12 min at 88–93% FTP, 5 min recovery"
    );
  });

  it("names a point target without a range", () => {
    const b: Block[] = [
      {
        name: "Main set",
        repeat: 5,
        steps: [
          { secs: 240, lo: 110, hi: 110 },
          { secs: 240, lo: 50, hi: 50 },
        ],
      },
    ];
    expect(renderDescription(b)).toBe("5 × 4 min at 110% FTP, 4 min recovery");
  });

  it("falls back to total time and target when nothing repeats", () => {
    const b: Block[] = [
      { name: "Ride", repeat: 1, steps: [{ secs: 5400, lo: 56, hi: 75 }] },
    ];
    expect(renderDescription(b)).toBe("90 min at 56–75% FTP");
  });

  it("uses an en dash in ranges, matching the app's prose", () => {
    const b: Block[] = [
      { name: "Main set", repeat: 2, steps: [{ secs: 600, lo: 88, hi: 94 }] },
    ];
    expect(renderDescription(b)).toContain("88–94%");
    expect(renderDescription(b)).not.toContain("88-94%");
  });

  it("describes an unrolled over-under by its whole work body", () => {
    // THE CASE THAT BROKE THE FIRST IMPLEMENTATION. The main set is 6 x 2 min
    // alternating 105/90, then 5 min recovery. Peak-step logic called the
    // five non-peak work steps "recovery" and reported 15 min of it.
    const b: Block[] = [
      {
        name: "Warmup",
        repeat: 1,
        steps: [{ secs: 600, lo: 50, hi: 65, ramp: true }],
      },
      {
        name: "Main set",
        repeat: 3,
        steps: [
          { secs: 120, lo: 105, hi: 105 },
          { secs: 120, lo: 90, hi: 90 },
          { secs: 120, lo: 105, hi: 105 },
          { secs: 120, lo: 90, hi: 90 },
          { secs: 120, lo: 105, hi: 105 },
          { secs: 120, lo: 90, hi: 90 },
          { secs: 300, lo: 55, hi: 55 },
        ],
      },
      { name: "Cooldown", repeat: 1, steps: [{ secs: 540, lo: 50, hi: 50 }] },
    ];
    expect(renderDescription(b)).toBe(
      "3 × 12 min at 90–105% FTP, 5 min recovery"
    );
  });

  it("does not treat two references to one step object as one step", () => {
    // A hoisted rest is a thing library authors will write. Reference
    // equality would drop both copies together.
    const REST: Step = { secs: 300, lo: 55, hi: 55 };
    const b: Block[] = [
      {
        name: "Main set",
        repeat: 4,
        steps: [
          { secs: 480, lo: 95, hi: 100 },
          REST,
          { secs: 480, lo: 95, hi: 100 },
          REST,
        ],
      },
    ];
    // Only the TRAILING step is recovery; the interior rest is part of the
    // work body, which is described by its span rather than invented away.
    expect(renderDescription(b)).toBe(
      "4 × 21 min at 55–100% FTP, 5 min recovery"
    );
  });

  it("describes a long ride by its body, not by the surges bolted onto it", () => {
    // THE CASE SLICE 2's LIBRARY FOUND. Choosing the block with the highest
    // repeat made a 235-minute endurance ride read as "5 × 1 min at 105–115%
    // FTP, 4 min recovery" — a four-hour ride described as a twenty-five
    // minute interval session. The body owns the time, so the body leads.
    const b: Block[] = [
      { name: "Warmup", repeat: 1, steps: [{ secs: 900, lo: 50, hi: 70 }] },
      {
        name: "Endurance",
        repeat: 1,
        steps: [{ secs: 10800, lo: 56, hi: 70 }],
      },
      {
        name: "Surges",
        repeat: 5,
        steps: [
          { secs: 60, lo: 105, hi: 115 },
          { secs: 240, lo: 55, hi: 65 },
        ],
      },
      { name: "Cooldown", repeat: 1, steps: [{ secs: 900, lo: 50, hi: 50 }] },
    ];
    expect(renderDescription(b)).toBe(
      "180 min at 56–70% FTP, with 5 × 1 min at 105–115% FTP, 4 min recovery"
    );
  });

  it("names no efforts when a steady block owns the ride alone", () => {
    const b: Block[] = [
      { name: "Warmup", repeat: 1, steps: [{ secs: 900, lo: 50, hi: 70 }] },
      { name: "Endurance", repeat: 1, steps: [{ secs: 5400, lo: 56, hi: 72 }] },
      { name: "Cooldown", repeat: 1, steps: [{ secs: 900, lo: 50, hi: 50 }] },
    ];
    expect(renderDescription(b)).toBe("90 min at 56–72% FTP");
  });

  it("returns an empty string rather than throwing on no steps", () => {
    // Not a workout. The caller keeps its own description; it must not get a
    // TypeError, which is what seeding a reduce with `all[0]` produced.
    expect(renderDescription([])).toBe("");
    expect(renderDescription([{ name: "X", repeat: 1, steps: [] }])).toBe("");
  });
});
