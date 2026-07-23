import { describe, expect, it } from "vitest";
import {
  ALL_DESCRIPTION_FIELDS,
  isFieldEnabled,
  sanitizeDescriptionFields,
  type DescriptionFields,
} from "./strava-description-fields";

describe("ALL_DESCRIPTION_FIELDS", () => {
  it("lists all 15 fields exactly once and never the marker", () => {
    const keys = ALL_DESCRIPTION_FIELDS.map((f) => f.key);
    expect(keys).toHaveLength(15);
    expect(new Set(keys).size).toBe(15);
    expect(keys).not.toContain("marker");
  });

  it("gives every field a non-empty label", () => {
    for (const f of ALL_DESCRIPTION_FIELDS) {
      expect(f.label.length).toBeGreaterThan(0);
    }
  });
});

describe("isFieldEnabled", () => {
  it("enables every field when config is null or undefined", () => {
    for (const { key } of ALL_DESCRIPTION_FIELDS) {
      expect(isFieldEnabled(null, key)).toBe(true);
      expect(isFieldEnabled(undefined, key)).toBe(true);
    }
  });

  it("treats a saved object as an explicit allowlist", () => {
    const fields: DescriptionFields = { load: true, trimp: false };
    expect(isFieldEnabled(fields, "load")).toBe(true);
    expect(isFieldEnabled(fields, "trimp")).toBe(false);
    // Absent key → disabled, so a field added in a later version never
    // silently appears in an already-configured user's public description.
    expect(isFieldEnabled(fields, "vo2max")).toBe(false);
  });

  it("disables everything for an empty object", () => {
    for (const { key } of ALL_DESCRIPTION_FIELDS) {
      expect(isFieldEnabled({}, key)).toBe(false);
    }
  });

  it("treats non-true values as disabled", () => {
    const fields = { load: 1, ctl: "yes" } as unknown as DescriptionFields;
    expect(isFieldEnabled(fields, "load")).toBe(false);
    expect(isFieldEnabled(fields, "ctl")).toBe(false);
  });
});

describe("sanitizeDescriptionFields", () => {
  it("keeps only known keys set to exactly true", () => {
    expect(
      sanitizeDescriptionFields({
        load: true,
        trimp: false,
        bogus: true,
        vo2max: "true",
      })
    ).toEqual({ load: true });
  });

  it("returns an empty object for non-object input", () => {
    expect(sanitizeDescriptionFields(null)).toEqual({});
    expect(sanitizeDescriptionFields(undefined)).toEqual({});
    expect(sanitizeDescriptionFields("load")).toEqual({});
    expect(sanitizeDescriptionFields(42)).toEqual({});
  });

  it("round-trips an all-on set", () => {
    const allOn = Object.fromEntries(
      ALL_DESCRIPTION_FIELDS.map((f) => [f.key, true])
    );
    expect(sanitizeDescriptionFields(allOn)).toEqual(allOn);
  });
});
