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

  /**
   * The pair the GOAL SENTENCE rests on, and the one figure here that had
   * drifted in the direction nobody wants.
   *
   * "102 of 120 … (16 Medium, 2 High)" was written on 2026-08-24 and was
   * still there on 2026-09-04, by which point the truth was 117 of 136 with
   * 17 Medium. Sixteen constants and one Medium had arrived in the window, so
   * the epistemic debt the roadmap reports had GROWN while the roadmap
   * reported it unchanged — on the clause the whole file calls "deliberately
   * testable".
   *
   * THE MEASUREMENT IS THE GREP, DELIBERATELY. A stricter parse — a JSDoc
   * block carrying `Confidence:` immediately above an `export const` — gives
   * 101, and is arguably closer to what the prose says. It is not used here:
   * the historical figure was produced by this grep (verified by re-running
   * it at 8151e48a, the commit that wrote the number, where it returns
   * exactly 102/16/2), so counting a different way would silently redefine
   * the claim while appearing to correct it. That substitution — a narrower
   * true metric quietly replacing the stated one — is the failure this repo
   * has recorded three times. Change the measurement only by changing the
   * sentence too.
   */
  it("states the real spread of confidence labels", () => {
    const levels = ["Low", "Medium", "High"] as const;
    const counts = Object.fromEntries(levels.map((l) => [l, 0])) as Record<
      (typeof levels)[number],
      number
    >;

    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".ts") && !entry.name.includes(".test.")) {
          const src = readFileSync(full, "utf8");
          for (const level of levels) {
            counts[level] += (
              src.match(new RegExp(`Confidence: ${level}`, "g")) ?? []
            ).length;
          }
        }
      }
    };
    walk(join(process.cwd(), "src/lib"));

    const total = counts.Low + counts.Medium + counts.High;
    expect(
      claimed(/(\d+) of \d+ are still\n`Confidence: Low`/, "a Low count")
    ).toBe(counts.Low);
    expect(
      claimed(/\d+ of (\d+) are still\n`Confidence: Low`/, "a total")
    ).toBe(total);
    expect(
      claimed(/carry `Confidence: Low` \((\d+) Medium/, "a Medium count")
    ).toBe(counts.Medium);
    expect(
      claimed(
        /carry `Confidence: Low` \(\d+ Medium, (\d+) High\)/,
        "a High count"
      )
    ).toBe(counts.High);

    // The pair is stated TWICE — once in the goal section, once in "Where
    // Recover stands" — and the assertions above read the Low/total from the
    // first and the Medium/High from the second. Pin the second's Low/total
    // too, or the two sentences can drift apart from each other while every
    // assertion above still passes. Found by mutating this very test: raising
    // only the second line's Low went undetected.
    expect(
      claimed(
        /(\d+) of \d+ exported\nengine constants carry/,
        "a second Low count"
      )
    ).toBe(counts.Low);
    expect(
      claimed(/\d+ of (\d+) exported\nengine constants carry/, "a second total")
    ).toBe(total);
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
