import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { allTools } from "@/lib/tools/registry";
import { LIBRARY } from "@/lib/interval/library";

const roadmap = readFileSync(join(process.cwd(), "docs/ROADMAP.md"), "utf8");
const readme = readFileSync(join(process.cwd(), "README.md"), "utf8");

function claimed(pattern: RegExp, what: string): number {
  const m = pattern.exec(roadmap);
  expect(m, `ROADMAP.md no longer states ${what}`).not.toBeNull();
  return Number(m![1]);
}

/**
 * ROADMAP's "Mechanically sound" line makes four countable claims, and
 * nothing has ever checked any of them.
 *
 * Two were wrong when this was written. The test count said 3452 against
 * 3455 — that one rots on almost every pull request and is now dated rather
 * than guarded, because a guard on it would fail work that is going well.
 * The other said "an 83-token design system", which is the exact figure
 * v0.125.0's visual-polish strand identified as stale INSIDE
 * `docs/design-system.md` and corrected there; the correction never reached
 * this file, so the roadmap kept quoting a number the repo had already
 * disproved, off by more than 3x.
 *
 * The three guarded here change rarely, so the friction is near zero and the
 * claim stops depending on someone happening to re-count.
 */
describe("ROADMAP's countable claims", () => {
  it("states the real number of migrations", () => {
    const files = readdirSync(join(process.cwd(), "drizzle")).filter((f) =>
      f.endsWith(".sql")
    );
    expect(claimed(/(\d+) migrations/, "a migration count")).toBe(files.length);
  });

  it("states the real size of the MCP surface", () => {
    // allTools is the registry both consumers read — the coach and MCP — so
    // it is the only number that can be wrong in one place.
    expect(claimed(/a (\d+)-tool MCP surface/, "an MCP tool count")).toBe(
      allTools.length
    );
  });

  it("agrees with README about the size of the MCP surface", () => {
    // The same number lives in three places and only one was checked, so the
    // two documents could drift apart while each looked internally fine.
    // README states it twice: once live, and once as "59 tools as of
    // v0.119.0" — that second one is DATED and deliberately not asserted
    // here, the same treatment ROADMAP's test count gets. A dated claim
    // records what was true; only a live one can go wrong silently.
    const live = /(\d+) tools:/.exec(readme);
    expect(live, "README no longer states a live tool count").not.toBeNull();
    expect(Number(live![1])).toBe(allTools.length);
  });

  it("states the real size of the workout library, and agrees with README", () => {
    // ADDED AFTER THE COUNT ROTTED TWICE. README said "a curated library of
    // thirty" for two releases after v0.127.0 took it to 46, and the spec's
    // own "100+" target went unmet and unnoticed for a release. Both are the
    // same failure the token count had: a number quoted in prose that nothing
    // recomputes. LIBRARY is the one place it can be wrong.
    expect(claimed(/library of \*\*(\d+) workouts/, "a workout count")).toBe(
      LIBRARY.length
    );
    const live = /curated library of (\d+)\n?\s*hand-authored/.exec(readme);
    expect(live, "README no longer states a library size").not.toBeNull();
    expect(Number(live![1])).toBe(LIBRARY.length);
  });

  it("states the real size of the design system, both ways", () => {
    // Two different true numbers, and quoting one without the other is how
    // "83" survived: unique token NAMES, and total DECLARATIONS across the
    // light and dark theme blocks that redefine many of them.
    const css = readFileSync(
      join(process.cwd(), "src/app/globals.css"),
      "utf8"
    );
    const decls = css.match(/^\s*--[a-zA-Z0-9-]+\s*:/gm) ?? [];
    const names = new Set(decls.map((d) => d.trim().replace(/\s*:$/, "")));
    expect(claimed(/a (\d+)-token design system/, "a token count")).toBe(
      names.size
    );
    expect(
      claimed(/across (\d+)\s*\n?declarations/, "a declaration count")
    ).toBe(decls.length);
  });
});
