// tests/viewport-zoom-guard.test.ts — WCAG 2.2 SC 1.4.4 (Resize Text).
//
// The app disabled pinch-zoom in TWO places, and a fix that only removes one
// leaves zoom broken while looking finished:
//   1. layout.tsx's viewport export — maximumScale: 1, userScalable: false
//   2. globals.css — html { touch-action: pan-x pan-y }
// On a release whose premise is that 284 of 395 hardcoded type sizes are 11px
// or smaller, preventing magnification is the sharpest possible contradiction.
//
// ── WIDENED (I7, whole-branch review 2026-08-11) ───────────────────────────
// The version that shipped read exactly two literal paths — src/app/layout.tsx
// and src/app/globals.css — and asserted against their whole text. Everything
// outside those two files was invisible to it, and four of those blind spots
// are things a later slice would plausibly write:
//
//   1. A NESTED LAYOUT WITH ITS OWN VIEWPORT. Next merges `viewport` exports
//      per route, and a `viewport` exported from any layout, page or template
//      at any depth applies to that subtree. A route group added by slice 5
//      (Settings/Menu) or slice 8 (pre-auth) could reinstate maximumScale for
//      its own routes and this file would not have opened the file. Now every
//      .ts/.tsx under src/app is read, at any nesting depth.
//   2. `generateViewport()` INSTEAD OF `export const viewport`. Next accepts
//      either. Once the blocker patterns are keyed on the object PROPERTY
//      rather than on the export statement, both forms are covered by the
//      same scan — which is why there is no separate assertion for it.
//   3. TAILWIND'S TOUCH UTILITIES. `touch-none` compiles to
//      `touch-action: none` and `touch-pan-y` to `touch-action: pan-y`, in a
//      .tsx file, with no CSS anywhere for the globals.css scan to find.
//      Scanned across all of src/ now, not just src/app.
//   4. `touch-action: none`, WHICH THE OLD PATTERN DID NOT MATCH AT ALL. It
//      only looked for `pan`. `none` blocks every gesture including
//      pinch-zoom, so it was the easier of the two to reintroduce and the one
//      nothing checked.
//
// Also covered, because they are the same defect written differently: a raw
// `<meta name="viewport" content="…maximum-scale=1, user-scalable=no">` tag
// (the pre-Next spelling, and what a copy-pasted snippet looks like), and
// `style={{ touchAction: "none" }}` — the inline-style path, which is the
// class of hole C2 was about.
//
// MATCHING IS KEYED ON THE PROPERTY, NOT THE BARE WORD. `/maximumScale/`
// would fire on a comment explaining why maximumScale must never return,
// which trains people to weaken guards. `/\bmaximumScale\b["']?\s*:/` fires
// only where the word is used as an object key — the only place it can have
// any effect — so prose about it is free.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = join(process.cwd(), "src");
const APP = join(process.cwd(), "src/app");
const GLOBALS_CSS = join(APP, "globals.css");

function walk(dir: string, match: RegExp, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, match, out);
    else if (match.test(full) && !/\.test\.tsx?$/.test(full)) out.push(full);
  }
  return out;
}

const rel = (f: string) => relative(process.cwd(), f);

/**
 * Every file Next can read a viewport declaration from. `viewport` and
 * `generateViewport` are only honoured in `layout`/`page`/`template` files,
 * but this reads every source file under src/app anyway: the cost is nothing,
 * and it removes "was this file eligible?" as a thing the guard can get wrong.
 */
const APP_SOURCES = walk(APP, /\.tsx?$/);
/** Every component file, for the Tailwind touch utilities. */
const TSX_SOURCES = walk(SRC, /\.tsx?$/);
/** Every stylesheet, for raw touch-action declarations. */
const CSS_SOURCES = walk(SRC, /\.css$/);

interface Blocker {
  label: string;
  pattern: RegExp;
  files: string[];
}

/** Anything that caps or disables user scaling, in any spelling Next accepts. */
const VIEWPORT_BLOCKERS: Blocker[] = [
  {
    label: "maximumScale (Next Viewport object)",
    pattern: /\bmaximumScale\b["']?\s*:/g,
    files: APP_SOURCES,
  },
  {
    label: "userScalable (Next Viewport object)",
    pattern: /\buserScalable\b["']?\s*:/g,
    files: APP_SOURCES,
  },
  {
    label: "maximum-scale= (raw <meta> viewport content)",
    pattern: /\bmaximum-scale\s*=/g,
    files: APP_SOURCES,
  },
  {
    label: "user-scalable= (raw <meta> viewport content)",
    pattern: /\buser-scalable\s*=/g,
    files: APP_SOURCES,
  },
];

/** Anything that stops the browser handling a pinch, in any spelling. */
const TOUCH_BLOCKERS: Blocker[] = [
  {
    // `touch-none` → touch-action: none; `touch-pan-y` → touch-action: pan-y.
    // `touch-auto` and `touch-manipulation` are fine and deliberately absent:
    // manipulation only drops the double-tap delay, it keeps pinch-zoom.
    label: "Tailwind touch-none / touch-pan-* utility",
    pattern: /\btouch-(?:none|pan-(?:x|y|left|right|up|down))\b/g,
    files: TSX_SOURCES,
  },
  {
    label: 'inline style touchAction: "none" / "pan…"',
    pattern: /\btouchAction\b["']?\s*:\s*["'][^"']*(?:none|pan)/g,
    files: TSX_SOURCES,
  },
  {
    // Widened from `pan` only: `none` blocks pinch-zoom too, and was the one
    // spelling nothing checked.
    label: "CSS touch-action: none / pan…",
    pattern: /touch-action\s*:\s*(?:none|pan)[^;}]*/g,
    files: CSS_SOURCES,
  },
];

function hits({ pattern, files }: Blocker): string[] {
  const found: string[] = [];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    text.split("\n").forEach((line, i) => {
      for (const m of line.match(new RegExp(pattern.source, "g")) ?? []) {
        found.push(`${rel(file)}:${i + 1} — ${m.trim()}`);
      }
    });
  }
  return found;
}

/**
 * THE RECORD of where a viewport is declared at all — not a blocker scan.
 * The blocker scans above catch a bad viewport wherever it lives, so this is
 * not load-bearing for WCAG 1.4.4. What it catches is a NEW declaration site
 * appearing: Next merges per-route viewports, so a second one is a second
 * place this concern lives, and whoever adds it should have to look at this
 * file rather than inherit the root layout's guarantees by accident.
 *
 * Regenerate by copying the `actual` array out of the failure message.
 */
const VIEWPORT_DECLARATION_SITES: readonly string[] = ["src/app/layout.tsx"];

const VIEWPORT_DECLARATION =
  /export\s+(?:const\s+viewport\b|(?:async\s+)?function\s+generateViewport\b)/;

function viewportDeclarationSites(): string[] {
  return APP_SOURCES.filter((f) =>
    VIEWPORT_DECLARATION.test(readFileSync(f, "utf8"))
  )
    .map(rel)
    .sort();
}

describe("pinch-zoom is not blocked", () => {
  // Sanity first, so every assertion below cannot pass vacuously against a
  // renamed directory, an empty walk, or a readFileSync that threw.
  it("walks the App Router and the component tree", () => {
    expect(APP_SOURCES.map(rel)).toContain("src/app/layout.tsx");
    expect(
      APP_SOURCES.length,
      "src/app has 67 source files today"
    ).toBeGreaterThan(20);
    expect(TSX_SOURCES.length, "src/ has ~392 today").toBeGreaterThan(100);
    expect(CSS_SOURCES.map(rel)).toContain("src/app/globals.css");
  });

  it("globals.css still declares an html rule", () => {
    expect(readFileSync(GLOBALS_CSS, "utf8")).toMatch(/\bhtml\s*\{/);
  });

  for (const blocker of VIEWPORT_BLOCKERS) {
    it(`no route declares ${blocker.label}`, () => {
      expect(
        hits(blocker),
        `capping or disabling user scaling breaks WCAG 1.4.4. Next merges ` +
          `viewport exports per route, so this applies to every layout, page ` +
          `and template under src/app — not only the root — and to ` +
          `generateViewport() as well as export const viewport.`
      ).toEqual([]);
    });
  }

  for (const blocker of TOUCH_BLOCKERS) {
    it(`nothing uses ${blocker.label}`, () => {
      expect(
        hits(blocker),
        `touch-action: none and touch-action: pan* both stop the browser ` +
          `handling a pinch (WCAG 1.4.4). Use touch-manipulation if you only ` +
          `want the double-tap delay gone.`
      ).toEqual([]);
    });
  }

  it("has exactly the recorded set of viewport declaration sites", () => {
    expect(
      viewportDeclarationSites(),
      "a new viewport (or generateViewport) declaration appeared. Next merges " +
        "these per route, so it now shares responsibility for pinch-zoom on " +
        "its subtree. Confirm it does not cap scaling, then add it to " +
        "VIEWPORT_DECLARATION_SITES."
    ).toEqual(VIEWPORT_DECLARATION_SITES);
  });
});
