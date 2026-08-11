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
import { CSS_PATH, GOVERNED, readTokenSets } from "../src/lib/design/tokens";

const SRC = join(process.cwd(), "src");

/** Arbitrary type sizes: text-[10px], text-[0.75rem]. */
const ARBITRARY_TYPE = /\btext-\[[^\]]*(?:px|rem|em)\]/g;
/**
 * Ad-hoc ink: text-white/40, bg-white/5, border-white/10, ring-white/50,
 * divide-white/5, and Tailwind's bracket arbitrary-opacity syntax —
 * bg-white/[0.06]. Both opacity syntaxes and both the ring/divide prefixes
 * are live in src/ today (138 bracket-syntax and 8 ring/divide occurrences
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

/**
 * This file's own blind spot, closed (Task 6b, 2026-08-11): everything above
 * scans src/**\/*.tsx because Tailwind only compiles classes that appear
 * literally in source — sound for utilities, silent about raw CSS. A
 * `color: rgba(255,255,255,0.4)` inside globals.css's component classes was
 * invisible to it: a light-mode capture run found the "Welcome to Recover"
 * heading unreadable, caused by exactly this class of hardcoded dark-only
 * value living outside the token blocks. This assertion scans
 * globals.css itself for the two shapes those values took — translucent
 * white/black `rgba()` and literal ink/surface token hex — everywhere in the
 * file EXCEPT inside `:root { … }` / `.dark { … }` blocks, which is where
 * literal colour belongs and where tests/contrast-guard.test.ts already
 * governs it.
 *
 * Deliberately scoped to ink/surface, not accent: excluding "accent" from
 * GOVERNED means a hardcoded brand-green hex (there is one today, in
 * `.tag-active`, pre-existing and out of this task's scope) does not trip
 * this guard. That is a real, different, smaller bug — not this one.
 */
const GLOBALS_CSS = readFileSync(CSS_PATH, "utf8");

const NEUTRAL_HEXES = (() => {
  const { light, dark } = readTokenSets();
  const hexes = new Set<string>();
  for (const token of GOVERNED) {
    if (token === "accent") continue; // brand colour, not ink/surface
    hexes.add(light[token].toLowerCase());
    hexes.add(dark[token].toLowerCase());
  }
  return [...hexes];
})();

const RGBA_WHITE = /rgba\(\s*255\s*,\s*255\s*,\s*255\s*,\s*[\d.]+\s*\)/;
const RGBA_BLACK = /rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*[\d.]+\s*\)/;
const HARDCODED_INK_SURFACE_PATTERNS = [
  RGBA_WHITE,
  RGBA_BLACK,
  ...NEUTRAL_HEXES.map((hex) => new RegExp(hex.replace("#", "#"))),
];

/**
 * Blanks out every top-level `:root { … }` / `.dark { … }` block, and every
 * `/* … *\/` comment, character by character (newlines preserved) so line
 * numbers in the remaining text still match the real file. Comments must be
 * masked too — this guard's own doc comments quote the historical rgba()
 * values they replaced, which would otherwise self-trigger. A raw colour
 * anywhere left standing after both maskings is a live declaration outside
 * the token blocks, by construction.
 */
function maskTokenBlocksAndComments(css: string): string {
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, (c) =>
    c.replace(/[^\n]/g, " ")
  );
  return noComments.replace(/^(?::root|\.dark)\s*\{[\s\S]*?^\}/gm, (block) =>
    block.replace(/[^\n]/g, " ")
  );
}

function globalsCssOffenders(): string[] {
  const masked = maskTokenBlocksAndComments(GLOBALS_CSS);
  const found: string[] = [];
  masked.split("\n").forEach((line, i) => {
    for (const pattern of HARDCODED_INK_SURFACE_PATTERNS) {
      const matches = line.match(new RegExp(pattern.source, "gi"));
      if (matches) {
        found.push(`src/app/globals.css:${i + 1} — ${matches.join(", ")}`);
      }
    }
  });
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

  // A real assertion, not it.fails: Task 6b brought globals.css to zero
  // offenders as part of landing this guard, so — unlike the two scale
  // guards above — there is nothing left to grow into. See the block
  // comment above describe() for why src/**/*.tsx scanning alone missed
  // this class of defect for the whole life of the file until now.
  it("has no hardcoded ink or surface colour in globals.css outside :root/.dark", () => {
    expect(
      globalsCssOffenders(),
      "raw rgba(255,255,255,*), rgba(0,0,0,*), or a literal ink/surface " +
        "token hex belongs only inside :root/.dark — reference the token " +
        "with var(--…) from the component class instead"
    ).toEqual([]);
  });
});
