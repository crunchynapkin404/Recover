import { describe, expect, it } from "vitest";
import {
  blockMins,
  validateBlocks,
  ENERGY_CEILING,
  PURPOSE_FLOORS,
  SUBSTITUTE_TO,
  type AvailabilityBlock,
} from "./types";

const block = (o: Partial<AvailabilityBlock> = {}): AvailabilityBlock => ({
  start: "18:00",
  end: "19:30",
  mins: 90,
  energy: "normal",
  sports: null,
  ...o,
});

describe("blockMins", () => {
  it("derives minutes from clock times", () => {
    expect(blockMins(block({ start: "06:30", end: "07:15", mins: 999 }))).toBe(
      45
    );
  });

  it("falls back to stored mins on legacy blocks with no times", () => {
    expect(blockMins(block({ start: null, end: null, mins: 75 }))).toBe(75);
  });
});

describe("validateBlocks", () => {
  it("accepts non-overlapping ordered blocks", () => {
    expect(
      validateBlocks([
        block({ start: "06:30", end: "07:15", mins: 45 }),
        block({ start: "19:00", end: "20:00", mins: 60 }),
      ])
    ).toBeNull();
  });

  it("rejects an end before its start", () => {
    expect(
      validateBlocks([block({ start: "19:00", end: "18:00", mins: 0 })])
    ).toBe("A block must end after it starts.");
  });

  it("rejects overlapping blocks", () => {
    expect(
      validateBlocks([
        block({ start: "18:00", end: "19:30", mins: 90 }),
        block({ start: "19:00", end: "20:00", mins: 60 }),
      ])
    ).toBe("Blocks on the same day cannot overlap.");
  });

  it("accepts an empty list — that is an unavailable day", () => {
    expect(validateBlocks([])).toBeNull();
  });

  // ── "HH:MM" shape gap ────────────────────────────────────────────────
  // toMinutes() has no shape check of its own — a malformed clock string
  // silently becomes NaN, and the end-after-start/overlap comparisons
  // above (NaN <= NaN, NaN < NaN) are always false, so a garbage string
  // would otherwise sail straight through. validateBlocks is called by
  // every writer (parseDayBlocks, setStandardWeekDay, setDayOverride), so
  // the shape guard belongs here rather than only at the form boundary.

  it("keeps a legacy block with both start and end null", () => {
    expect(
      validateBlocks([block({ start: null, end: null, mins: 45 })])
    ).toBeNull();
  });

  it("keeps a valid timed block", () => {
    expect(
      validateBlocks([block({ start: "06:00", end: "07:00", mins: 60 })])
    ).toBeNull();
  });

  it("rejects a non-time garbage string", () => {
    expect(validateBlocks([block({ start: "garbage", end: "19:30" })])).toBe(
      "A block's start and end must both be times, or both be empty."
    );
  });

  it("rejects a time string with no colon", () => {
    expect(validateBlocks([block({ start: "1830", end: "19:30" })])).toBe(
      "A block's start and end must both be times, or both be empty."
    );
  });

  it("rejects an impossible hour", () => {
    expect(validateBlocks([block({ start: "25:00", end: "26:00" })])).toBe(
      "A block's start and end must both be times, or both be empty."
    );
  });

  it("rejects an impossible minute", () => {
    expect(validateBlocks([block({ start: "12:60", end: "13:00" })])).toBe(
      "A block's start and end must both be times, or both be empty."
    );
  });

  it("rejects one null and one set clock field", () => {
    expect(validateBlocks([block({ start: "18:00", end: null })])).toBe(
      "A block's start and end must both be times, or both be empty."
    );
    expect(validateBlocks([block({ start: null, end: "19:00" })])).toBe(
      "A block's start and end must both be times, or both be empty."
    );
  });

  it("catches a malformed shape before the end-after-start comparison would run", () => {
    // "garbage" <= "garbage" via toMinutes() is NaN <= NaN, always false —
    // this must resolve via the shape message, not silently pass.
    expect(validateBlocks([block({ start: "garbage", end: "garbage" })])).toBe(
      "A block's start and end must both be times, or both be empty."
    );
  });
});

describe("engine tables", () => {
  it("caps easy energy at aerobic work", () => {
    expect(ENERGY_CEILING.easy).toEqual(["recovery", "aerobic_base", "long"]);
    expect(ENERGY_CEILING.normal).toContain("threshold");
    expect(ENERGY_CEILING.normal).not.toContain("vo2max");
    expect(ENERGY_CEILING.full).toContain("vo2max");
    expect(ENERGY_CEILING.full).toContain("brick");
  });

  it("pins the purpose floors from the spec", () => {
    expect(PURPOSE_FLOORS).toEqual({
      recovery: 20,
      aerobic_base: 40,
      threshold: 45,
      vo2max: 40,
      brick: 60,
      long: 90,
    });
  });

  it("steps each purpose toward the nearest lesser stimulus", () => {
    expect(SUBSTITUTE_TO.vo2max).toBe("threshold");
    expect(SUBSTITUTE_TO.threshold).toBe("aerobic_base");
    expect(SUBSTITUTE_TO.aerobic_base).toBe("recovery");
    expect(SUBSTITUTE_TO.brick).toBe("threshold");
    expect(SUBSTITUTE_TO.long).toBe("aerobic_base");
    expect(SUBSTITUTE_TO.recovery).toBeUndefined();
  });
});
