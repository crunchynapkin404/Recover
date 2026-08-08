// tests/uncertainty-dialects-guard.test.ts — regression guard for the
// correlation-evidence conflation docs/specs/2026-08-08-uncertainty-vocabulary-design.md
// and docs/plans/2026-08-08-uncertainty-vocabulary.md (Task 3) fixed.
//
// "limited evidence" (not enough tagged days —
// src/lib/insights/correlations.ts's evidence: "limited") and "inconclusive"
// (a real, high-confidence finding of no effect) used to render identically.
// correlationFigure() now maps the first to Figure.calibrating(...) and the
// second to Figure.available(..., "high"), and correlation-rows.tsx was
// rewritten to use it. This guard fails if either literal string returns
// anywhere outside a test file.
//
// This list is deliberately NOT all six retired dialects from the spec's
// table yet — only the two this plan's Task 3 actually fixed. It grows one
// migrated surface at a time; do not add an unmigrated phrase here, or this
// guard fails permanently until that surface's own fix lands.
//
// KNOWN EXCEPTION: src/components/journal/correlation-insights.tsx has no
// render site anywhere in src/ (confirmed 2026-08-08) and duplicates the
// same retired strings. It is excluded here rather than fixed — which cycle
// disposes of the app's 12 orphaned components is Phase 2b.2's decision
// (docs/ROADMAP.md), not this plan's.
//
// KNOWN LIMITATION: this is a literal substring match. It catches the
// realistic reintroduction (a copy-pasted ternary) but not one built through
// indirection (string concatenation, a template literal split across
// lines). Treat a pass as evidence against the common case, not proof.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(__dirname, "..");
const SRC_ROOT = join(REPO_ROOT, "src");

const RETIRED_PHRASES = ["limited evidence", "inconclusive"];

const KNOWN_ORPHANS = new Set([
  join(SRC_ROOT, "components/journal/correlation-insights.tsx"),
]);

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

describe("retired correlation-evidence dialects", () => {
  it("never reappear outside a test file", () => {
    const offenders: string[] = [];
    for (const file of walkSourceFiles(SRC_ROOT)) {
      if (KNOWN_ORPHANS.has(file)) continue;
      const text = readFileSync(file, "utf8");
      for (const phrase of RETIRED_PHRASES) {
        if (text.includes(phrase)) offenders.push(`${file}: "${phrase}"`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
