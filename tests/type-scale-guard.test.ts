// tests/type-scale-guard.test.ts — Phase 2b.4's second guardrail.
//
// v0.99.0's premise: 300 hardcoded pixel sizes over 16 distinct values, 239
// of them 11px or smaller, and 8 ad-hoc ink alphas of which three fail AA.
//
// WHY A SOURCE SCAN IS SOUND HERE, unlike the source-parsing guard v0.39
// deleted: Tailwind v4 only compiles classes that appear as literal strings
// in source. An arbitrary `text-[9px]` that is not a literal never renders.
// So anything that can reach the screen is findable by scanning, and the
// scan cannot be defeated by a class assembled at runtime — such a class
// produces no CSS either.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = join(process.cwd(), "src");

/** Arbitrary type sizes: text-[10px], text-[0.75rem]. */
const ARBITRARY_TYPE = /\btext-\[[^\]]*(?:px|rem|em)\]/g;
/**
 * Ad-hoc ink: text-white/40, bg-white/5, border-white/10, ring-white/50,
 * divide-white/5, and Tailwind's bracket arbitrary-opacity syntax —
 * bg-white/[0.06]. Both opacity syntaxes and both the ring/divide prefixes
 * are live in src/ today (138 bracket-syntax and 9 ring/divide occurrences
 * respectively as of v0.99.0) — a pattern that misses either would let real
 * offenders through undetected.
 */
const ADHOC_INK =
  /\b(?:text|bg|border|fill|stroke|ring|divide)-(?:white|black)\/(?:\d+|\[[^\]]+\])/g;
/** hairline is a non-text token; using it as text colour is the one misuse. */
const HAIRLINE_AS_TEXT = /\btext-hairline\b/g;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(full) && !/\.test\.tsx?$/.test(full))
      out.push(full);
  }
  return out;
}

function offenders(pattern: RegExp): string[] {
  const found: string[] = [];
  for (const file of walk(SRC)) {
    const text = readFileSync(file, "utf8");
    for (const line of text.split("\n").entries()) {
      const [i, content] = line;
      const matches = content.match(new RegExp(pattern.source, "g"));
      if (matches) {
        found.push(
          `${relative(process.cwd(), file)}:${i + 1} — ${matches.join(", ")}`
        );
      }
    }
  }
  return found;
}

describe("type-scale guard", () => {
  // Not an `it.fails` — this pins that the scan actually walked a plausible
  // source tree, rather than silently measuring nothing. `it.fails` cannot
  // tell "scanned everything and found real offenders" apart from "walk() or
  // readFileSync threw / src/ was renamed / SRC resolved to an empty dir" —
  // both report as an expected failure either way. src/ has 392 non-test
  // .ts/.tsx files today; 100 is comfortably below that so this cannot pass
  // vacuously on a handful of files, while staying well clear of flaking on
  // ordinary file-count drift as the app grows.
  it("walks a real, non-trivial source tree", () => {
    const files = walk(SRC);
    expect(files.length).toBeGreaterThan(100);
  });

  // TODO(slice-9): flip to `it(` once the last surface is migrated. Tracked
  // in docs/plans/2026-08-11-v099-slice0-foundations.md. Do NOT delete these
  // — a skipped guard that is deleted is a guard that never lands.
  it.fails("has no arbitrary type sizes — use the scale", () => {
    expect(offenders(ARBITRARY_TYPE), "use text-label … text-hero").toEqual([]);
  });

  // TODO(slice-9): flip to `it(` once the last surface is migrated. Tracked
  // in docs/plans/2026-08-11-v099-slice0-foundations.md. Do NOT delete these
  // — a skipped guard that is deleted is a guard that never lands.
  it.fails("has no ad-hoc white/black alpha utilities — use the tokens", () => {
    expect(
      offenders(ADHOC_INK),
      "use ink-primary / ink-secondary / ink-muted / hairline / surface-*"
    ).toEqual([]);
  });

  // Unlike the two guards above, this one has zero offenders today — nothing
  // in src/ currently misuses hairline as a text colour — so it is a real,
  // currently-passing assertion rather than an expected failure. Per Step 5:
  // an it.fails that unexpectedly passes is the signal to flip it; this is
  // that flip, done at implementation time instead of at slice-9 time.
  it("never uses hairline as a text colour", () => {
    expect(
      offenders(HAIRLINE_AS_TEXT),
      "hairline is 3.0:1 — legal for dividers and strokes, never for text"
    ).toEqual([]);
  });
});
