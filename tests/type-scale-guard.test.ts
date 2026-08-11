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
import { CSS_PATH } from "../src/lib/design/tokens";
import { findColorLiterals, isNeutral } from "../src/lib/design/color-literals";

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
 * value living outside the token blocks.
 *
 * ── AND THE HOLE IN THAT CLOSURE (C1, whole-branch review 2026-08-11) ─────
 * The first version of the scan enumerated two `rgba()` spellings plus the
 * literal hex values of the ink/surface tokens. `rgb(255 255 255 / 40%)`,
 * `#ffffff66`, `hsl(0 0% 100%)`, `color-mix(in srgb, white 40%, transparent)`
 * and the bare keyword `white` — which was live in `.nav-active-dot` the
 * whole time — all walked through it. The scan is now syntax-agnostic:
 * src/lib/design/color-literals.ts recognises *that a colour literal is
 * present* from CSS's own closed grammar (any-length hex, colour functions by
 * NAME so every argument spelling is covered, neutral colour keywords) and
 * then judges what it MEANS rather than how it was spelled. See that file's
 * header for why the shape is inverted.
 *
 * Still deliberately scoped to ink/surface, not brand: a literal that reduces
 * to a chromatic colour (there are five today — the two 8%-alpha mesh blooms
 * and `.tag-active`/`.login-input:focus`'s emerald, all pre-existing and out
 * of this task's scope) does not trip this guard. That scope is now derived
 * from the colour itself — achromatic within NEUTRAL_TOLERANCE — instead of
 * from a hand-copied hex list, so it holds for syntaxes nobody has written
 * yet. It is a real, different, smaller bug — not this one.
 *
 * Masking the `:root`/`.dark` blocks is legitimate now that it was not
 * before: tests/contrast-guard.test.ts reads every one of the six blocks and
 * requires every declaration in them to be checked, aliased or waived by
 * name. When this comment was first written that claim was false for four of
 * the six.
 */
const GLOBALS_CSS = readFileSync(CSS_PATH, "utf8");

/**
 * Blanks out every `:root { … }` / `.dark { … }` block, and every `/* … *\/`
 * comment, character by character (newlines preserved) so line numbers in
 * the remaining text still match the real file. Comments must be masked too
 * — this guard's own doc comments quote the historical rgba() values they
 * replaced, which would otherwise self-trigger. A raw colour anywhere left
 * standing after both maskings is a live declaration outside the token
 * blocks, by construction.
 */
function maskTokenBlocksAndComments(css: string): string {
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, (c) =>
    c.replace(/[^\n]/g, " ")
  );
  return noComments.replace(/^(?::root|\.dark)\s*\{[\s\S]*?^\}/gm, (block) =>
    block.replace(/[^\n]/g, " ")
  );
}

/**
 * A CSS declaration, anchored to the `{` or `;` that must precede one. This
 * is what separates a *value* from a selector, so `.glass:hover {` and
 * `@media (hover: hover)` are not mistaken for declarations and — the part a
 * line-by-line scan got wrong — the continuation lines of a multi-line value
 * (`.mesh-gradient`'s three stacked gradients) are still read.
 */
const CSS_DECLARATION = /(?:^|[;{}])\s*((?:--)?[-a-zA-Z]+)\s*:\s*([^;{}]*)/g;

function globalsCssOffenders(): string[] {
  const masked = maskTokenBlocksAndComments(GLOBALS_CSS);
  const found: string[] = [];
  for (const m of masked.matchAll(CSS_DECLARATION)) {
    const [property, value] = [m[1], m[2]];
    const valueStart = m.index + m[0].length - value.length;
    for (const literal of findColorLiterals(value)) {
      // Chromatic literals are brand colour, out of this guard's scope. An
      // unparseable one (`oklch()`, `color-mix()`) is an offender: a raw
      // colour nobody can evaluate is exactly what belongs behind a token.
      if (literal.rgba && !isNeutral(literal.rgba)) continue;
      const line = masked
        .slice(0, valueStart + literal.index)
        .split("\n").length;
      found.push(`src/app/globals.css:${line} — ${property}: ${literal.text}`);
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

  // A real assertion, not it.fails: Task 6b brought globals.css to zero
  // offenders as part of landing this guard, so — unlike the two scale
  // guards above — there is nothing left to grow into. See the block
  // comment above describe() for why src/**/*.tsx scanning alone missed
  // this class of defect for the whole life of the file until now.
  it("has no hardcoded ink or surface colour in globals.css outside :root/.dark", () => {
    expect(
      globalsCssOffenders(),
      "a raw neutral colour — in ANY syntax: hex of any length, any colour " +
        "function, a keyword like `white` — belongs only inside :root/.dark, " +
        "where tests/contrast-guard.test.ts governs it. Reference the token " +
        "with var(--…) from the component class instead"
    ).toEqual([]);
  });
});
