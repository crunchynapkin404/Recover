// tests/dead-component-guard.test.ts — Phase 2d's first guardrail
// (docs/specs/2026-08-11-dead-component-guard-design.md). "A test failing on
// any component with zero non-test render sites. Would have caught the 7
// sleep-card files and the 12 found after them."
//
// For every non-test .tsx under src/components, this asserts that at least
// one other non-test .ts/.tsx file under src/ references it — either by its
// `@/`-prefixed module specifier (e.g. "@/components/today/race-chip") or by
// a relative import path ending in its basename (e.g. "./race-chip" or
// "../today/race-chip"). A component with neither, and not listed in
// KNOWN_ORPHANS below, fails the test.
//
// KNOWN LIMITATION: reference detection is a text match on module specifier
// and basename. It will miss a component reached only through a dynamic
// import built at runtime (e.g. a computed string passed to import()), and
// it can be fooled by a basename appearing in an unrelated string that isn't
// actually an import. Treat a pass as evidence against the common case — a
// component whose last import was deleted — not as proof of liveness. The
// same honest caveat tests/uncertainty-dialects-guard.test.ts carries.
//
// THE ALLOWLIST IS A RATCHET, NOT A DUMPING GROUND. KNOWN_ORPHANS below is
// seeded with the 15 components a full scan on 2026-08-11 found with zero
// non-test render sites (down from a stale figure of 19 — v0.87.0 deleted
// RaceCountdownCard and others since). These are superseded predecessors,
// not lost features: debriefs still render today, through
// src/components/today/debrief-chip.tsx on Today and
// src/components/debrief/activity-debrief-section.tsx on the activity page,
// so debrief/pending-debrief-card.tsx is a leftover, not a silently-broken
// surface. plan/today-card.tsx is the sharpest argument for this guard: it
// was *edited* on 2026-07-27 by a week-plan refactor commit while rendering
// nowhere — someone read a dead component, reasoned about it, and updated
// it. Dead components do not sit quietly; they get maintained.
//
// Disposing of any of the 15 is Phase 2b.2's decision (docs/ROADMAP.md), not
// this guard's, and 2b.2 cannot settle before 2026-09-05 — it depends on the
// four-week surface_views telemetry window that opened 2026-08-08. Some may
// be worth reviving with usage data rather than deleting outright.
//
// journal/correlation-insights.tsx is allowlisted for the same underlying
// reason in tests/uncertainty-dialects-guard.test.ts (see that file's KNOWN
// EXCEPTION comment) — same component, same root cause, cross-referenced
// here rather than duplicated.
//
// src/components/ui/ is IN SCOPE, not exempt. separator.tsx, sonner.tsx and
// tabs.tsx are vendored primitives that a future feature might reach for,
// which is the standard argument for exempting the ui/ directory wholesale.
// That argument is declined here: an unused primitive is still code that is
// typechecked, linted, bundled if imported, and read by people. It goes in
// this list on the same terms as everything else — shrink-only, and gone
// once Phase 2b.2 decides.
//
// Nothing may be added to KNOWN_ORPHANS without a comment here naming why. A
// new orphan showing up is the exact defect this guard exists to catch.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, extname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(__dirname, "..");
const SRC_ROOT = join(REPO_ROOT, "src");
const COMPONENTS_ROOT = join(SRC_ROOT, "components");

// Paths relative to SRC_ROOT, e.g. "components/dashboard/behavior-tags.tsx".
const KNOWN_ORPHANS = new Set([
  "components/dashboard/behavior-tags.tsx",
  "components/dashboard/coach-insight.tsx", // last touched 2026-07-15
  "components/dashboard/hero-readiness.tsx", // its own last commit removed the headline it rendered
  "components/dashboard/morning-brief.tsx", // last touched 2026-07-14
  "components/dashboard/recent-sessions-accordion.tsx",
  "components/debrief/pending-debrief-card.tsx", // superseded by today/debrief-chip.tsx
  "components/journal/correlation-insights.tsx", // also allowlisted in uncertainty-dialects-guard.test.ts
  "components/log/wellness-trends.tsx",
  "components/plan/availability-sheet.tsx",
  "components/plan/today-card.tsx", // maintained 2026-07-27 while dead — the guard's actual argument
  "components/scroll-reveal.tsx",
  "components/train/week-adjustment-switch.tsx",
  "components/ui/separator.tsx", // vendored primitive, in scope, not exempt
  "components/ui/sonner.tsx", // vendored primitive, in scope, not exempt
  "components/ui/tabs.tsx", // vendored primitive, in scope, not exempt
]);

function isTestFile(name: string): boolean {
  return name.endsWith(".test.ts") || name.endsWith(".test.tsx");
}

function walkFiles(
  dir: string,
  extensions: string[],
  out: string[] = []
): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const info = statSync(full);
    if (info.isDirectory()) {
      walkFiles(full, extensions, out);
      continue;
    }
    if (!extensions.includes(extname(entry))) continue;
    if (isTestFile(entry)) continue;
    out.push(full);
  }
  return out;
}

/** Every non-test .tsx under src/components. */
function walkComponentFiles(): string[] {
  return walkFiles(COMPONENTS_ROOT, [".tsx"]);
}

/** Every non-test .ts/.tsx under src/. */
function walkAllSourceFiles(): string[] {
  return walkFiles(SRC_ROOT, [".ts", ".tsx"]);
}

/**
 * True if `text` references the component at `componentPath` (absolute),
 * either via its `@/`-prefixed module specifier or a relative import path
 * ending in its basename.
 */
function referencesComponent(text: string, componentPath: string): boolean {
  const relFromSrc = relative(SRC_ROOT, componentPath)
    .replace(/\.tsx$/, "")
    .split("\\")
    .join("/");
  const atSpecifier = `@/${relFromSrc}`;
  if (text.includes(atSpecifier)) return true;

  const base = basename(componentPath, ".tsx");
  const relativeImportPattern = new RegExp(`/${base}["'\`]`);
  return relativeImportPattern.test(text);
}

/** Finds every component under src/components with zero references from any
 * other non-test source file in src/. */
function findOrphanedComponents(): string[] {
  const componentFiles = walkComponentFiles();
  const allSourceFiles = walkAllSourceFiles();
  const fileTextCache = new Map<string, string>();
  const getText = (f: string): string => {
    let cached = fileTextCache.get(f);
    if (cached === undefined) {
      cached = readFileSync(f, "utf8");
      fileTextCache.set(f, cached);
    }
    return cached;
  };

  const orphans: string[] = [];
  for (const component of componentFiles) {
    const referenced = allSourceFiles.some((other) => {
      if (other === component) return false;
      return referencesComponent(getText(other), component);
    });
    if (!referenced) orphans.push(component);
  }
  return orphans;
}

describe("dead-component guard", () => {
  it("fails on any component with zero non-test render sites, unless allowlisted", () => {
    const orphans = findOrphanedComponents();
    const unexpectedOrphans = orphans.filter(
      (f) => !KNOWN_ORPHANS.has(relative(SRC_ROOT, f).split("\\").join("/"))
    );

    if (unexpectedOrphans.length > 0) {
      const message = unexpectedOrphans
        .map(
          (f) =>
            `${relative(REPO_ROOT, f)} has no reference from any other ` +
            `non-test source file under src/. Either delete it, wire it up ` +
            `with a real render site, or add it to KNOWN_ORPHANS in ` +
            `tests/dead-component-guard.test.ts with a comment stating why.`
        )
        .join("\n");
      expect.fail(message);
    }
  });

  it("keeps KNOWN_ORPHANS a ratchet: every allowlisted entry is still genuinely orphaned", () => {
    const allSourceFiles = walkAllSourceFiles();
    const failures: string[] = [];

    for (const relPath of KNOWN_ORPHANS) {
      const absPath = join(SRC_ROOT, relPath);
      let exists: boolean;
      try {
        exists = statSync(absPath).isFile();
      } catch {
        exists = false;
      }
      if (!exists) {
        failures.push(
          `KNOWN_ORPHANS lists "${relPath}", which no longer exists on ` +
            `disk. Remove this entry from KNOWN_ORPHANS in ` +
            `tests/dead-component-guard.test.ts.`
        );
        continue;
      }

      const referencedBy = allSourceFiles.find((other) => {
        if (other === absPath) return false;
        return referencesComponent(readFileSync(other, "utf8"), absPath);
      });
      if (referencedBy) {
        failures.push(
          `KNOWN_ORPHANS lists "${relPath}", but it is now referenced from ` +
            `${relative(REPO_ROOT, referencedBy)}. It is no longer orphaned ` +
            `— remove this entry from KNOWN_ORPHANS in ` +
            `tests/dead-component-guard.test.ts.`
        );
      }
    }

    if (failures.length > 0) expect.fail(failures.join("\n"));
  });
});
