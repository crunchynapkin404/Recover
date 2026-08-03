import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A source-level guard, deliberately not DB-backed.
 *
 * DB-gated tests skip in CI — a DB-backed regression test enforces nothing
 * there. This one always runs, and it is the only thing standing between a
 * future edit and fill firing on a readiness path.
 *
 * Documented blind spot: a call site that passes the options through a
 * variable rather than an inline object literal escapes this scan.
 */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return full.endsWith(".ts") || full.endsWith(".tsx") ? [full] : [];
  });
}

describe("fill wiring", () => {
  it("is enabled from applyAvailability and nowhere else", () => {
    const enabling = sourceFiles("src")
      .filter((f) => !f.endsWith(".test.ts") && !f.endsWith(".test.tsx"))
      .filter((f) => /\btargetMins\s*:/.test(readFileSync(f, "utf8")));

    expect(enabling.sort()).toEqual([
      join("src", "lib", "week-plan", "fill.ts"),
      join("src", "lib", "week-plan", "service.ts"),
    ]);
  });
});
