import { describe, it, expect } from "vitest";
import {
  athletePlacement,
  blockIdxOf,
  blockPlacement,
  isAthleteChosen,
  normalizePlacement,
  type AthleteChoice,
} from "./placement";

const choice: AthleteChoice = {
  workoutId: "thr-4x8",
  chosenAt: "2026-09-03T07:00:00.000Z",
};

describe("blockIdxOf", () => {
  it("returns the index for a block placement", () => {
    expect(blockIdxOf(blockPlacement(1))).toBe(1);
  });

  it("returns null for an athlete placement — it occupies no block", () => {
    expect(blockIdxOf(athletePlacement(choice))).toBeNull();
  });
});

describe("isAthleteChosen", () => {
  it("is true only for an athlete placement", () => {
    expect(isAthleteChosen({ placement: athletePlacement(choice) })).toBe(true);
    expect(isAthleteChosen({ placement: blockPlacement(0) })).toBe(false);
  });
});

describe("normalizePlacement", () => {
  it("maps a legacy bare index onto a block placement", () => {
    expect(normalizePlacement({ blockIdx: 2 })).toEqual({
      kind: "block",
      blockIdx: 2,
    });
  });

  it("passes a new-shape placement through untouched", () => {
    const p = athletePlacement(choice);
    expect(normalizePlacement({ placement: p })).toEqual(p);
  });

  it("prefers placement over a dual-written legacy blockIdx", () => {
    expect(
      normalizePlacement({
        placement: { kind: "block", blockIdx: 3 },
        blockIdx: 3,
      })
    ).toEqual({ kind: "block", blockIdx: 3 });
  });

  it("falls back to block 0 for a row carrying neither", () => {
    expect(normalizePlacement({})).toEqual({ kind: "block", blockIdx: 0 });
  });

  it("is idempotent", () => {
    const once = normalizePlacement({ blockIdx: 2 });
    expect(normalizePlacement({ placement: once })).toEqual(once);
  });
});
