import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Two source-level guards, deliberately not DB-backed — DB-gated tests skip
 * in CI and would enforce nothing there.
 *
 * PRIMARY ("every replanWeek call passes null except..."): parses every
 * `replanWeek(...)` call site in non-test source and asserts its 4th
 * argument's literal text is exactly `null`, except one call site — the one
 * inside `applyAvailability` in service.ts, identified by enclosing
 * function name plus file path (not line number, so ordinary edits don't
 * break it). This is what actually matters: it reads the call's real
 * argument text, so it catches a NEW CALL SITE anywhere, including a second
 * one added inside an already-allow-listed file that forwards an existing
 * `FillOptions` value through a variable instead of writing a fresh object
 * literal. That exact shape — a second call site in service.ts, the same
 * file `runDailyAdaptation` (the readiness path fill must never run on)
 * already lives in — is precisely what the older, file-scan-only version of
 * this guard missed.
 *
 * SECONDARY ("targetMins: appears only in..."), kept for defense in depth:
 * no non-test source file other than fill.ts/service.ts mentions
 * `targetMins:` at all. Weaker alone — it is a file-level grep, blind to
 * *how many* call sites a file has or what they pass — but still an
 * independent signal if a brand-new file starts constructing FillOptions.
 *
 * REAL remaining blind spots of the PRIMARY guard, stated plainly:
 * - It is a lexical scan, not an execution or type check. A call routed
 *   through an alias (`const rw = replanWeek; rw(a, b, c, fill)`), a
 *   `.call`/`.apply`/optional-chaining invocation, or a re-exported/
 *   shadowed function also named `replanWeek` would not match the literal
 *   `replanWeek(` text pattern and would escape both scans entirely.
 * - Test files (`*.test.ts`/`*.test.tsx`) are excluded from both scans on
 *   purpose: replan.test.ts legitimately calls `replanWeek` with real,
 *   non-null `FillOptions` dozens of times to exercise the pure engine
 *   directly — that is correct test code, not production wiring, and
 *   folding it in would make "exactly one enabling call site" false by
 *   construction. A test file that itself invoked production wiring
 *   incorrectly would not be caught here; only `src/**` is in scope.
 * - The allow-listed call site is identified by enclosing function NAME
 *   ("applyAvailability") AND file path (src/lib/week-plan/service.ts)
 *   together. A second, unrelated function also named `applyAvailability`
 *   defined in that same file would be wrongly permitted. A same-named
 *   function in a different file is correctly rejected (the file-path half
 *   of the check catches that case).
 * - The 4th-argument text must be the exact literal `null` to count as
 *   "disabled" — a variable that always happens to hold `null` at runtime
 *   (e.g. `const noFill = null; replanWeek(a, b, c, noFill)`) reads as
 *   non-null text and is treated as a violation unless it's the allowed
 *   site. That's a deliberate false-positive risk, not a false-negative
 *   one: it forces callers to write `null` (or route through
 *   applyAvailability) rather than obscure intent through indirection.
 */

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return full.endsWith(".ts") || full.endsWith(".tsx") ? [full] : [];
  });
}

function isTestFile(f: string): boolean {
  return f.endsWith(".test.ts") || f.endsWith(".test.tsx");
}

/** Non-test .ts/.tsx files under src/, paths relative to the repo root. */
function productionSourceFiles(): string[] {
  return sourceFiles("src").filter((f) => !isTestFile(f));
}

/**
 * Byte offset of the opening "(" for each `replanWeek(...)` CALL in
 * `content` — skips the function's own declaration (`function replanWeek(`)
 * by checking that the token immediately before `replanWeek` isn't
 * `function`.
 */
function callSiteOpenParens(content: string): number[] {
  const sites: number[] = [];
  const re = /replanWeek\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    const before = content.slice(Math.max(0, m.index - 30), m.index);
    if (/function\s*$/.test(before)) continue; // the declaration, not a call
    sites.push(m.index + m[0].length - 1); // index of the "(" itself
  }
  return sites;
}

/**
 * Balanced, string-aware scan from an opening "(" to its matching ")",
 * returning everything strictly between them (nested parens/braces/brackets
 * and quoted strings are kept intact, not split on).
 */
function extractBalancedArgs(content: string, openParenIdx: number): string {
  let depth = 0;
  let out = "";
  let quote: string | null = null;
  for (let i = openParenIdx; i < content.length; i++) {
    const c = content[i];
    if (quote) {
      out += c;
      if (c === "\\") {
        i++;
        if (i < content.length) out += content[i];
        continue;
      }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      out += c;
      continue;
    }
    if (c === "(") {
      depth++;
      if (depth === 1) continue; // the call's own opening paren
      out += c;
      continue;
    }
    if (c === ")") {
      depth--;
      if (depth === 0) break; // the call's own closing paren
      out += c;
      continue;
    }
    out += c;
  }
  return out;
}

/**
 * Strips `//` and `/* *\/` comments from an argument-list string,
 * string-aware (a `//` or `/*` inside a quoted string is left alone). Found
 * necessary the hard way: `null // TODO(Task 8): ...` — the exact form the
 * pre-Task-8 call site used — left the 4th argument's text as `"null //
 * TODO..."`, which is not `=== "null"`, so an un-stripped scan would have
 * silently treated a `null` call site carrying a trailing comment as a
 * "non-null, must be the allowed site" case instead of a disabled one.
 */
function stripComments(s: string): string {
  let out = "";
  let quote: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      out += c;
      if (c === "\\") {
        i++;
        if (i < s.length) out += s[i];
        continue;
      }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      out += c;
      continue;
    }
    if (c === "/" && s[i + 1] === "/") {
      while (i < s.length && s[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && s[i + 1] === "*") {
      i += 2;
      while (i < s.length && !(s[i] === "*" && s[i + 1] === "/")) i++;
      i++; // land on the "/" of "*/"; loop's i++ moves past it
      continue;
    }
    out += c;
  }
  return out;
}

/** Splits an argument-list string on its TOP-LEVEL commas, string-aware. */
function splitTopLevelArgs(args: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let cur = "";
  for (let i = 0; i < args.length; i++) {
    const c = args[i];
    if (quote) {
      cur += c;
      if (c === "\\") {
        i++;
        if (i < args.length) cur += args[i];
        continue;
      }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      cur += c;
      continue;
    }
    if (c === "(" || c === "{" || c === "[") {
      depth++;
      cur += c;
      continue;
    }
    if (c === ")" || c === "}" || c === "]") {
      depth--;
      cur += c;
      continue;
    }
    if (c === "," && depth === 0) {
      parts.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  if (cur.trim().length > 0) parts.push(cur);
  return parts.map((p) => p.trim());
}

/** Nearest preceding top-level `function NAME(` declaration before `idx`. */
function enclosingFunctionName(content: string, idx: number): string | null {
  const re = /function\s+([A-Za-z0-9_$]+)\s*\(/g;
  let name: string | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    if (m.index >= idx) break;
    name = m[1];
  }
  return name;
}

const ALLOWED_FILE = join("src", "lib", "week-plan", "service.ts");
const ALLOWED_FUNCTION = "applyAvailability";

describe("fill wiring", () => {
  it("every replanWeek call passes null except the one inside applyAvailability", () => {
    const violations: string[] = [];
    let sawTheAllowedCallSite = false;

    for (const file of productionSourceFiles()) {
      const content = readFileSync(file, "utf8");
      for (const openParenIdx of callSiteOpenParens(content)) {
        const parts = splitTopLevelArgs(
          stripComments(extractBalancedArgs(content, openParenIdx))
        );
        const fourth = parts[3];
        const line = content.slice(0, openParenIdx).split("\n").length;
        const fn = enclosingFunctionName(content, openParenIdx);
        const isAllowedSite = file === ALLOWED_FILE && fn === ALLOWED_FUNCTION;
        const where = `${file}:${line} (in ${fn ?? "<top level>"})`;

        if (parts.length !== 4) {
          violations.push(
            `${where} calls replanWeek with ${parts.length} arguments, expected 4`
          );
          continue;
        }

        if (fourth === "null") {
          if (isAllowedSite) {
            violations.push(
              `${where} passes null — expected the applyAvailability call site to enable fill`
            );
          }
          continue;
        }

        // Non-null 4th argument: legal only at the one allow-listed site.
        if (isAllowedSite) {
          sawTheAllowedCallSite = true;
        } else {
          violations.push(
            `${where} passes a non-null 4th argument (${JSON.stringify(
              fourth
            )}) to replanWeek — only applyAvailability in ${ALLOWED_FILE} may do this`
          );
        }
      }
    }

    expect(violations).toEqual([]);
    // Confirms fill IS enabled somewhere, not merely that it's disabled
    // everywhere else — a change that flipped applyAvailability's own call
    // back to `null` would otherwise pass this test by producing zero
    // violations.
    expect(sawTheAllowedCallSite).toBe(true);
  });

  it("targetMins: appears only in fill.ts and service.ts (secondary, weaker signal)", () => {
    const enabling = productionSourceFiles().filter((f) =>
      /\btargetMins\s*:/.test(readFileSync(f, "utf8"))
    );

    expect(enabling.sort()).toEqual([
      join("src", "lib", "week-plan", "fill.ts"),
      join("src", "lib", "week-plan", "service.ts"),
    ]);
  });
});
