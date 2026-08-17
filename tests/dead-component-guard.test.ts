// tests/dead-component-guard.test.ts — Phase 2d's first guardrail
// (docs/specs/2026-08-11-dead-component-guard-design.md). "A test failing on
// any component with zero non-test render sites. Would have caught the 7
// sleep-card files and the 12 found after them."
//
// For every non-test .tsx under src/components, this asserts the component is
// **reachable** from a real entry point: any file under src/app (Next's
// routes, pages and layouts) plus the root-level runtime files Next loads
// directly. Imports are resolved precisely — `@/`-prefixed and relative
// specifiers, against the actual file that exists on disk — and followed
// transitively. A component no path reaches, and not listed in KNOWN_ORPHANS
// below, fails the test.
//
// REACHABILITY REPLACED "IS ANYTHING REFERENCING IT" IN v0.96.0, AND IT
// FOUND SEVEN MORE. The original guard asked whether any non-test file under
// src/ mentioned the component. That question has two holes, both of which
// hide dead code rather than invent it, and both of which were live:
//
//   1. A reference from a file that is *itself* dead counted as liveness. Six
//      of the seven were this. They form chains, not pairs, so one hop is not
//      enough: dashboard/animated-counter.tsx was dead at depth three, behind
//      readiness-rings.tsx behind hero-readiness.tsx. Five of the six were
//      imported by a component already sitting in this very allowlist, so the
//      guard was reading its own known-dead entries as evidence of life.
//   2. The basename fallback matched a *sibling with the same name in another
//      directory*. dashboard/vitals-grid.tsx looked alive because
//      src/app/page.tsx imports "@/components/today/vitals-grid" — the regex
//      matched on "/vitals-grid\"". That is not the documented "unrelated
//      string" hazard; it is the predictable consequence of the unfinished
//      v0.23 migration, which duplicated dashboard/ names into today/. It is
//      the only such collision in the tree today, and the new resolver cannot
//      be fooled by it because it resolves to a path, not a name.
//
// Neither hole was cosmetic: had 2b.2 deleted the 15 this file used to list,
// these 7 would have turned from invisible into a red build.
//
// KNOWN LIMITATION: this reads static import specifiers. A component reached
// only through a dynamic import built at runtime (a computed string passed to
// import()) would read as dead. There are none in the tree as of v0.96.0 —
// checked, not assumed — so the risk is a future one. Treat a pass as strong
// evidence of liveness and a failure as a claim to verify by hand, not as an
// instruction to delete. The same honest caveat
// tests/uncertainty-dialects-guard.test.ts carries.
//
// THE ALLOWLIST IS A RATCHET, AND AS OF v0.98.0 IT IS EMPTY. It was seeded
// with the 22 components unreachable from any entry point on 2026-08-11 — the
// 15 the old reference-based scan found, plus the 7 it structurally could not
// see (above). Phase 2b.2 deleted all 22; each had a named live successor,
// verified to exist, and the four dead chains came out as units.
//
// They were superseded predecessors, not lost features. The post-ride debrief
// still works exactly as before, through today/debrief-chip.tsx,
// debrief/debrief-sheet.tsx and debrief/activity-debrief-section.tsx — the two
// deleted debrief files were the pre-v0.25.2 inline form and dashboard card
// that release had already replaced.
//
// plan/today-card.tsx was the sharpest argument for this guard: it was
// *edited* on 2026-07-27 by a week-plan refactor commit while rendering
// nowhere. Dead components do not sit quietly; they get maintained.
//
// src/components/ui/ was IN SCOPE, not exempt. separator, sonner and tabs
// were vendored primitives a future feature might have reached for, which is
// the standard argument for exempting ui/ wholesale. That argument was
// declined and they were deleted: re-vendoring is a one-line add, and the
// version added then will be current rather than a year stale.
//
// AN EMPTY LIST IS THE POINT. A new orphan now fails with no precedent to
// point at. Nothing may be added without a comment naming why that component
// should exist with no render site — and "we might want it later" is the
// reasoning that produced the original 22.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(__dirname, "..");
const SRC_ROOT = join(REPO_ROOT, "src");
const COMPONENTS_ROOT = join(SRC_ROOT, "components");

// Paths relative to SRC_ROOT, e.g. "components/dashboard/behavior-tags.tsx".
// EMPTY, AND IT SHOULD STAY THAT WAY. v0.98.0 deleted all 22 entries this
// list was seeded with; each had a named live successor, and the four dead
// chains came out as units. An empty allowlist is what makes this guard a
// real ratchet rather than a record of 22 tolerated exceptions — there is now
// no precedent for a new orphan to point at. Adding an entry means arguing
// that a component with no render site should exist, which is a claim that
// needs its reason written here.
const KNOWN_ORPHANS = new Set<string>([
  // v0.106 slice 5 (Settings redesign) task 2, 2026-08-17.
  // components/settings/connector-card.tsx is the shared shell extracted
  // out of the five connector cards (Strava, Whoop, Withings, Oura, Apple
  // Health), deliberately created before anything is wired to it: Tasks 3
  // and 4 migrate each card onto it, one commit apart from this one, so a
  // mistake in the extraction shows up against markup that has not moved
  // rather than in the same diff that also rewires five call sites. Remove
  // this entry once Task 3 lands the first real render site.
  "components/settings/connector-card.tsx",
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

/** Root-level files Next loads directly, alongside everything in src/app. */
const ROOT_ENTRY_FILES = ["proxy.ts", "instrumentation.ts", "middleware.ts"];

/** Matches `from "spec"`, `import("spec")` and `export ... from "spec"`. */
const SPECIFIER_PATTERN = /(?:from\s+|import\s*\(\s*)["'`]([^"'`]+)["'`]/g;

/**
 * Resolves a module specifier to the file it actually names, or null for
 * package imports and anything with no file on disk. This is what the old
 * basename fallback could not do: it resolves to a *path*, so a sibling of
 * the same name in another directory can never stand in for this one.
 */
function resolveSpecifier(
  spec: string,
  fromFile: string,
  known: Set<string>
): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(SRC_ROOT, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(fromFile), spec);
  else return null;

  for (const candidate of [
    `${base}.tsx`,
    `${base}.ts`,
    join(base, "index.tsx"),
    join(base, "index.ts"),
  ]) {
    if (known.has(candidate)) return candidate;
  }
  return null;
}

/** Every entry point: all of src/app, plus the root-level runtime files. */
function findEntryPoints(allSourceFiles: string[]): string[] {
  return allSourceFiles.filter((f) => {
    const rel = relative(SRC_ROOT, f).split("\\").join("/");
    return rel.startsWith("app/") || ROOT_ENTRY_FILES.includes(rel);
  });
}

/**
 * Finds every component under src/components that no entry point can reach.
 * Transitive by construction, so a chain of dead components cannot hold
 * itself up.
 */
function findOrphanedComponents(): string[] {
  const allSourceFiles = walkAllSourceFiles();
  const known = new Set(allSourceFiles);
  const textCache = new Map<string, string>();
  const getText = (f: string): string => {
    let cached = textCache.get(f);
    if (cached === undefined) {
      cached = readFileSync(f, "utf8");
      textCache.set(f, cached);
    }
    return cached;
  };

  const reachable = new Set<string>();
  const queue = findEntryPoints(allSourceFiles);
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (reachable.has(file)) continue;
    reachable.add(file);
    for (const match of getText(file).matchAll(SPECIFIER_PATTERN)) {
      const dep = resolveSpecifier(match[1], file, known);
      if (dep !== null && !reachable.has(dep)) queue.push(dep);
    }
  }

  return walkComponentFiles().filter((f) => !reachable.has(f));
}

describe("dead-component guard", () => {
  it("fails on any component unreachable from an entry point, unless allowlisted", () => {
    const orphans = findOrphanedComponents();
    const unexpectedOrphans = orphans.filter(
      (f) => !KNOWN_ORPHANS.has(relative(SRC_ROOT, f).split("\\").join("/"))
    );

    if (unexpectedOrphans.length > 0) {
      const message = unexpectedOrphans
        .map(
          (f) =>
            `${relative(REPO_ROOT, f)} is not reachable from any entry point ` +
            `(src/app/** or ${ROOT_ENTRY_FILES.join(", ")}). Either delete ` +
            `it, wire it up with a real render site, or add it to ` +
            `KNOWN_ORPHANS in tests/dead-component-guard.test.ts with a ` +
            `comment stating why. Note a chain: if this is imported only by ` +
            `something already in KNOWN_ORPHANS, it is dead too.`
        )
        .join("\n");
      expect.fail(message);
    }
  });

  it("keeps KNOWN_ORPHANS a ratchet: every allowlisted entry is still genuinely orphaned", () => {
    const stillOrphaned = new Set(
      findOrphanedComponents().map((f) =>
        relative(SRC_ROOT, f).split("\\").join("/")
      )
    );
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

      if (!stillOrphaned.has(relPath)) {
        failures.push(
          `KNOWN_ORPHANS lists "${relPath}", but it is now reachable from an ` +
            `entry point. It is no longer orphaned — remove this entry from ` +
            `KNOWN_ORPHANS in tests/dead-component-guard.test.ts.`
        );
      }
    }

    if (failures.length > 0) expect.fail(failures.join("\n"));
  });
});
