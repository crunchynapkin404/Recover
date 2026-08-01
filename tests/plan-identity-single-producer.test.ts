// tests/plan-identity-single-producer.test.ts — source-level guard for the
// defect v0.32.0 fixed.
//
// docs/specs/2026-08-01-plan-identity-design.md promises "one regression test
// that seeds three active plans and asserts all seven consumers return the
// same plan id" (tests/plan-identity-consumers.test.ts). That test exercises
// getActivePlan, get_training_plan, get_plan_drift and update_training_plan —
// four of seven. The two page components (src/app/page.tsx, src/app/train/
// page.tsx) and the two engine consumers (src/lib/week-plan/service.ts,
// src/lib/weekly-review.ts) have no committed parity coverage: the pages were
// checked once by hand in a browser, the engine paths only by a reviewer
// reading the diff.
//
// A DB-backed test can't render the two React Server Components without a
// browser. What CAN cover all seven — including those two — is a static
// guard: walk the source tree and assert that src/lib/active-plan.ts is the
// only file that queries trainingPlans filtered to status "active". If any
// consumer (old or new) ever resolves "the active plan" itself instead of
// calling getActivePlan(), this fails immediately, with no database and no
// browser required. That is also why this test carries no
// describe.skipIf(!hasDb) guard: it must run everywhere, including CI where
// DATABASE_URL is absent.
//
// Deliberately excluded: db.update(schema.trainingPlans)... .where(status =
// "active") (src/lib/training-plan.ts) and any .delete(...) of the same
// shape. Those are archive-the-old-rows WRITES — generateTrainingPlan
// archiving the previous plan before inserting a new one — not a read that
// decides "which plan is this athlete on". That is a different operation
// from the heap-order READ defect this release fixed, and conflating the two
// would make this guard fire on legitimate code.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(__dirname, "..");
const SRC_ROOT = join(REPO_ROOT, "src");

function walkSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const info = statSync(full);
    if (info.isDirectory()) {
      walkSourceFiles(full, out);
      continue;
    }
    const ext = extname(entry);
    if (ext !== ".ts" && ext !== ".tsx") continue;
    if (entry.endsWith(".test.ts") || entry.endsWith(".test.tsx")) continue;
    out.push(full);
  }
  return out;
}

/**
 * Given the index of an opening paren (already known to be one), returns the
 * text up to its matching closing paren, tracking depth so nested calls
 * inside the span don't trip an early match.
 */
function spanToMatchingParen(
  source: string,
  openParenIndex: number
): string | null {
  let depth = 1;
  let i = openParenIndex + 1;
  for (; i < source.length && depth > 0; i++) {
    if (source[i] === "(") depth++;
    else if (source[i] === ")") depth--;
  }
  return depth === 0 ? source.slice(openParenIndex + 1, i - 1) : null;
}

function looksLikeActiveStatusFilter(text: string): boolean {
  return /trainingPlans\.status/.test(text) && text.includes('"active"');
}

/**
 * True if `source` contains a READ that filters the trainingPlans table to
 * status "active" — via either drizzle API the codebase uses:
 *   - relational query API: db.query.trainingPlans.findFirst(...) / findMany(...)
 *   - query-builder API:    db.select(...).from(schema.trainingPlans)...where(...)
 * Writes (.update(schema.trainingPlans)/.delete(schema.trainingPlans)) are
 * intentionally not matched — see file header.
 */
function queriesActiveTrainingPlans(source: string): boolean {
  const findRe = /trainingPlans\.find(?:First|Many)\(/g;
  let m: RegExpExecArray | null;
  while ((m = findRe.exec(source)) !== null) {
    const span = spanToMatchingParen(source, m.index + m[0].length - 1);
    if (span && looksLikeActiveStatusFilter(span)) return true;
  }

  const fromRe = /\.from\(schema\.trainingPlans\)/g;
  while ((m = fromRe.exec(source)) !== null) {
    // .where(...) is chained after .from(...), not nested inside it — look
    // for it in the text that follows, then balance-parse just that call.
    const tailStart = m.index + m[0].length;
    const tail = source.slice(tailStart, tailStart + 500);
    const whereMatch = /\.where\(/.exec(tail);
    if (!whereMatch) continue;
    const openParenIndex =
      tailStart + whereMatch.index + whereMatch[0].length - 1;
    const span = spanToMatchingParen(source, openParenIndex);
    if (span && looksLikeActiveStatusFilter(span)) return true;
  }

  return false;
}

describe("active-plan resolution has a single producer", () => {
  it('only src/lib/active-plan.ts queries trainingPlans filtered to status "active"', () => {
    const matches = walkSourceFiles(SRC_ROOT)
      .filter((file) => queriesActiveTrainingPlans(readFileSync(file, "utf8")))
      .map((file) => relative(REPO_ROOT, file).split(sep).join("/"))
      .sort();

    expect(
      matches,
      `Found ${matches.length} file(s) querying trainingPlans filtered to status "active": ` +
        `${matches.join(", ") || "(none)"}. Active-plan resolution belongs solely in ` +
        `getActivePlan() (src/lib/active-plan.ts): v0.32.0 fixed a defect where five of seven ` +
        `call sites each resolved "the athlete's active plan" independently via unordered ` +
        `findFirst/findMany, which Postgres answers in heap order — the coach reported week 1 ` +
        `while the training engine ran week 4 on the same account. Route this lookup through ` +
        `getActivePlan(userId) instead of querying trainingPlans directly, or this defect class ` +
        `comes back.`
    ).toEqual(["src/lib/active-plan.ts"]);
  });
});
