import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PLAN_CONSTANTS } from "./plan-constants";

// NOT skipIf-gated, deliberately. This reads a file and touches no database.
// v0.40 found 89 of 245 test files skip on every PR for want of a
// DATABASE_URL; a DB-gated witness would enforce nothing.
const DOC = join(process.cwd(), "docs/specs/2026-08-06-periodize-evidence.md");

describe("periodize constants are documented", () => {
  const doc = readFileSync(DOC, "utf8");

  it("documents every constant in PLAN_CONSTANTS", () => {
    const undocumented = Object.keys(PLAN_CONSTANTS).filter(
      (name) => !doc.includes(`\`${name}\``)
    );
    expect(undocumented).toEqual([]);
  });

  it("states a confidence for every constant", () => {
    // Each constant gets a summary-table row ending in a confidence rating.
    for (const name of Object.keys(PLAN_CONSTANTS)) {
      const row = doc
        .split("\n")
        .find((l) => l.includes(`\`${name}\``) && l.startsWith("|"));
      expect(row, `no summary-table row for ${name}`).toBeDefined();
      expect(row).toMatch(/\b(High|Medium|Low)\b/);
    }
  });
});
