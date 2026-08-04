import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guards the week_plans insert in importUserData against silently dropping a
 * column the export side emits.
 *
 * The export's row shape for week_plans is `typeof schema.weekPlans.$inferSelect`
 * (export-user.ts's `UserExport` type) — every column on the `weekPlans`
 * table, verbatim, per export-user.ts's own table-by-table doc comment
 * ("INCLUDED, verbatim ... week_plans", no stripped fields noted). Drizzle's
 * insert type only requires columns that are `.notNull()` *and* have no
 * default — every nullable column (materializedMins, effectiveTarget,
 * availabilityConfirmedAt, availabilityPromptedAt, ...) is optional in the
 * insert's TS type, so TypeScript alone does not catch one being silently
 * omitted from the `.values({...})` call. This is exactly how Task 7's
 * `materializedMins` line could ship unwired: it typechecks with or without
 * that line, `scripts/export-import-drill.ts` typechecks while omitting
 * both `effectiveTarget` and `materializedMins` entirely, and the existing
 * round-trip test (import-user.test.ts) only asserts `.planId` on the
 * imported week_plans row — none of Task 7's columns.
 *
 * The authority for "what should be carried" is the `weekPlans` table
 * definition in schema.ts, not a hand-maintained list of column names here
 * — a hand list would need updating in lockstep with schema.ts and could
 * rot the exact same way the insert itself did.
 *
 * EXEMPT covers every column the week_plans insert in import-user.ts does
 * not copy verbatim from the exported row:
 *   - id: importUserData re-generates every row's id (see its header
 *     comment, "Fresh ids + FK remapping") — the exported id is read only
 *     to build the old->new id map, never written to the target row.
 *   - userId: rewritten to `targetUserId` (the importing account), not the
 *     exporting account's id — that's the entire point of "import into an
 *     existing user's account," not a merge.
 *   - planId: rewritten through the training_plans old->new id map built
 *     earlier in the same transaction (see the header comment's "FK-safe
 *     insert order") — the exported planId names a row that no longer
 *     exists in this database.
 *   - availabilityConfirmedAt, availabilityPromptedAt: NOT a deliberate
 *     transform. Reading the actual insert shows these two are simply
 *     absent, with no comment anywhere marking that as intentional, and
 *     export-user.ts's doc lists week_plans as fully "INCLUDED, verbatim"
 *     with nothing stripped. This looks like the same class of bug this
 *     test exists to catch — import-user.ts's own git history has five
 *     prior "fix(export): stop dropping N columns" commits for other
 *     tables. Fixing it is out of scope for this test-only change (which
 *     guards the materializedMins finding and touches no production code),
 *     so these two are exempted here rather than left to make this guard
 *     permanently red over a pre-existing, separately-discovered gap. See
 *     this release's final-review-fix-report.md — flagged there as a
 *     follow-up, not asserted here as correct.
 *
 * Deliberately source-level (reads .ts text, no DB): a DB-backed equivalent
 * would sit behind `describe.skipIf(!hasDb)` and enforce nothing in CI,
 * exactly like `tests/target-minutes-wiring.test.ts`.
 *
 * Blind spot, stated plainly: this assumes both blocks keep their current
 * shape — a flat `{ key: expr, ... }` object literal for the columns
 * argument to `pgTable(...)` in schema.ts, and for the `.values({...})`
 * call on `schema.weekPlans` in import-user.ts. A restructure of either
 * (e.g. spreading a variable into the values object, or moving columns into
 * a shared helper) would not match the regexes below and would silently
 * stop enforcing anything.
 */

const SCHEMA_PATH = join("src", "lib", "db", "schema.ts");
const IMPORT_PATH = join("src", "lib", "export", "import-user.ts");

// Deliberate (id/userId/planId, documented above) or a known pre-existing
// gap out of this test's scope (the availability pair, also documented
// above) — never add a name here to silence a failure without writing the
// matching reasoning into the comment block above.
const EXEMPT = new Set([
  "id",
  "userId",
  "planId",
  "availabilityConfirmedAt",
  "availabilityPromptedAt",
]);

function weekPlansSchemaColumns(): string[] {
  const src = readFileSync(SCHEMA_PATH, "utf8");
  const table = src.match(
    /export const weekPlans = pgTable\(\s*"week_plans",\s*\{([\s\S]*?)\n {2}\},\n {2}\(t\) =>/
  );
  if (!table) {
    throw new Error(
      "weekPlansSchemaColumns: couldn't locate the weekPlans pgTable column block in schema.ts — has its shape changed?"
    );
  }
  return [...table[1].matchAll(/^ {4}(\w+):/gm)].map((m) => m[1]);
}

function weekPlansInsertColumns(): string[] {
  const src = readFileSync(IMPORT_PATH, "utf8");
  const insert = src.match(
    /\.insert\(schema\.weekPlans\)\s*\.values\(\{([\s\S]*?)\}\)/
  );
  if (!insert) {
    throw new Error(
      "weekPlansInsertColumns: couldn't locate the week_plans .values({...}) block in import-user.ts — has its shape changed?"
    );
  }
  return [...insert[1].matchAll(/^\s*(\w+):/gm)].map((m) => m[1]);
}

describe("GDPR import carries every week_plans column the export emits", () => {
  it("has no schema column missing from the insert, apart from the documented exemptions", () => {
    const schemaColumns = weekPlansSchemaColumns();
    const insertColumns = new Set(weekPlansInsertColumns());

    // Sanity check on the extraction itself: if this ever comes back empty,
    // the regex stopped matching and every assertion below would pass
    // vacuously — fail loudly instead.
    expect(schemaColumns.length).toBeGreaterThan(0);

    const missing = schemaColumns.filter(
      (col) => !EXEMPT.has(col) && !insertColumns.has(col)
    );

    expect(missing).toEqual([]);
  });

  it("keeps every exemption pointed at a real column", () => {
    // Catches a stale or typo'd entry in EXEMPT — one that no longer names
    // an actual weekPlans column would silently widen what this guard
    // accepts without anyone noticing.
    const schemaColumns = new Set(weekPlansSchemaColumns());
    const staleExemptions = [...EXEMPT].filter(
      (col) => !schemaColumns.has(col)
    );
    expect(staleExemptions).toEqual([]);
  });
});
