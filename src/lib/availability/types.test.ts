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

// I6: validateBlocks is the only gate between raw JSON from a form field
// (parseDayBlocks) and availability_defaults / availability_overrides. A bad
// value stored there poisons every later materializeWeek/replanWeek for that
// user — admits() does ENERGY_CEILING[slot.energy].includes(...), which throws
// on an unrecognised tier. That is a persistent 500 on the plan engine which
// survives restarts, so the value must never reach the database.
describe("validateBlocks — value validation (I6)", () => {
  it("rejects an energy level the engine has no ceiling for", () => {
    expect(
      validateBlocks([
        block({
          energy: "superhuman" as unknown as AvailabilityBlock["energy"],
        }),
      ])
    ).toBe("A block's energy must be easy, normal or full.");
  });

  it("rejects a missing energy level", () => {
    expect(
      validateBlocks([
        block({ energy: undefined as unknown as AvailabilityBlock["energy"] }),
      ])
    ).toBe("A block's energy must be easy, normal or full.");
  });

  it("rejects negative or non-finite minutes on an untimed block", () => {
    expect(validateBlocks([block({ start: null, end: null, mins: -30 })])).toBe(
      "A block's minutes must be a whole number of minutes, not negative."
    );
    expect(
      validateBlocks([block({ start: null, end: null, mins: Number.NaN })])
    ).toBe(
      "A block's minutes must be a whole number of minutes, not negative."
    );
    expect(
      validateBlocks([
        block({
          start: null,
          end: null,
          mins: "60" as unknown as number,
        }),
      ])
    ).toBe(
      "A block's minutes must be a whole number of minutes, not negative."
    );
  });

  it("rejects a sports list that is not null and not a list of strings", () => {
    expect(
      validateBlocks([
        block({ sports: [3] as unknown as AvailabilityBlock["sports"] }),
      ])
    ).toBe("A block's sports must be names, or empty for any sport.");
    expect(
      validateBlocks([
        block({ sports: "Run" as unknown as AvailabilityBlock["sports"] }),
      ])
    ).toBe("A block's sports must be names, or empty for any sport.");
  });

  // Triage 1: sports: [] is deliberately distinct from null ("any sport"), but
  // admits() reads it as "no sport qualifies" — silently dead availability the
  // athlete cannot see. Reachable from the editor (toggling every sport off)
  // and from the coach (set_week_availability's zod allows []).
  it("rejects an all-sports-off block, which would admit nothing", () => {
    expect(validateBlocks([block({ sports: [] })])).toBe(
      "A block with no sport selected can never hold a session. Pick at least one, or leave it open to any sport."
    );
  });

  it("still accepts a well-formed block and null sports", () => {
    expect(validateBlocks([block({ sports: null })])).toBeNull();
    expect(validateBlocks([block({ sports: ["Run", "Bike"] })])).toBeNull();
    expect(
      validateBlocks([block({ start: null, end: null, mins: 0 })])
    ).toBeNull();
  });
});

describe("strength as a Purpose", () => {
  it("has a floor of 20 minutes", () => {
    expect(PURPOSE_FLOORS.strength).toBe(20);
  });

  it("is not admitted on an easy day", () => {
    // A fixed-load lift under low expected energy is closer to threshold/
    // vo2max risk than to aerobic_base — excluded for the same reason those
    // are. This is the pre-placement admission gate, not the whole story:
    // once placed, a lift's duration is never scaled either — adaptDay
    // (week-plan/adapt-day.ts) substitutes it to recovery via
    // SUBSTITUTE_TO.strength on red readiness, and leaves it exactly as
    // prescribed on amber. A lift fits a block whole or not at all
    // (fitToBlock, week-plan/slots.ts) — never compressed or duration-
    // scaled in place.
    expect(ENERGY_CEILING.easy).not.toContain("strength");
  });

  it("is admitted on normal and full days", () => {
    expect(ENERGY_CEILING.normal).toContain("strength");
    expect(ENERGY_CEILING.full).toContain("strength");
  });

  it("degrades to recovery rather than to a lighter lift", () => {
    // There is no "lighter strength" tier to fall back to, so the honest
    // substitution is out of the sport entirely.
    expect(SUBSTITUTE_TO.strength).toBe("recovery");
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
      strength: 20,
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
