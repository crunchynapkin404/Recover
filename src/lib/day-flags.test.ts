import { describe, expect, it } from "vitest";
import {
  ALL_DAY_FLAGS,
  isBaselineExcluded,
  sanitizeDayFlags,
} from "./day-flags";

describe("sanitizeDayFlags", () => {
  it("keeps known flags", () => {
    expect(sanitizeDayFlags(["ill", "travel", "altitude"])).toEqual([
      "ill",
      "travel",
      "altitude",
    ]);
  });

  it("drops unknown values — the column takes untrusted browser input", () => {
    expect(sanitizeDayFlags(["ill", "hacked", 42, null, { a: 1 }])).toEqual([
      "ill",
    ]);
  });

  it("de-duplicates", () => {
    expect(sanitizeDayFlags(["ill", "ill"])).toEqual(["ill"]);
  });

  it("returns [] for non-arrays and empties", () => {
    expect(sanitizeDayFlags(null)).toEqual([]);
    expect(sanitizeDayFlags(undefined)).toEqual([]);
    expect(sanitizeDayFlags("ill")).toEqual([]);
    expect(sanitizeDayFlags([])).toEqual([]);
  });
});

describe("isBaselineExcluded", () => {
  it("is true for any known flag — the rule is total, not per-flag", () => {
    for (const { key } of ALL_DAY_FLAGS) {
      expect(isBaselineExcluded([key])).toBe(true);
    }
  });

  it("is false for a normal day (null or [])", () => {
    expect(isBaselineExcluded(null)).toBe(false);
    expect(isBaselineExcluded(undefined)).toBe(false);
    expect(isBaselineExcluded([])).toBe(false);
  });

  it("is false when only unknown values are stored", () => {
    expect(isBaselineExcluded(["legacy-junk"] as never)).toBe(false);
  });
});
