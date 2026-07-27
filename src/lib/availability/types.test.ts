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
