// tests/ia-directory-guard.test.ts — Phase 2b.2's ratchet
//
// src/components/ mirrors the IA: a component lives under the surface that
// renders it, and a component rendered by two or more surfaces lives in a
// directory named for its domain (see src/components/week/README.md).
//
// These five directories are named for routes the app removed in v0.23. They
// were emptied in v0.99.0. This test exists because the tree drifted from the
// IA in v0.21 and AGAIN in v0.23, both times because nothing prevented it.
// Documentation did not hold. A red build does.
//
// Note `git mv` does not remove the directory it empties — git does not track
// directories — so a relocation that looks complete can leave the old name on
// disk. That is a real failure of this guard's rule and it is meant to fail;
// `rmdir` the leftover.
//
// If a genuine new surface appears, add its directory and leave this list
// alone: it names RETIRED routes, not an allowlist of permitted ones.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const COMPONENTS = join(__dirname, "..", "src", "components");

const RETIRED = ["dashboard", "plan", "log", "journal", "health"];

describe("IA directory guard", () => {
  it("has a component tree to check at all", () => {
    // Without this, moving or renaming src/components/ makes the assertion
    // below pass vacuously and the ratchet silently stops ratcheting.
    expect(existsSync(COMPONENTS)).toBe(true);
    expect(readdirSync(COMPONENTS).length).toBeGreaterThan(5);
  });

  it("has no directory named for a route the IA retired", () => {
    const present = RETIRED.filter((d) => existsSync(join(COMPONENTS, d)));
    expect(
      present,
      `src/components/${present.join(", ")} — named for routes removed in ` +
        `v0.23. A component belongs under the surface that renders it, or in ` +
        `a domain directory if two or more do. See ` +
        `docs/specs/2026-08-11-2b2-settle-the-ia-design.md.`
    ).toEqual([]);
  });
});
