// tests/viewport-zoom-guard.test.ts — WCAG 2.2 SC 1.4.4 (Resize Text).
//
// The app disabled pinch-zoom in TWO places, and a fix that only removes one
// leaves zoom broken while looking finished:
//   1. layout.tsx's viewport export — maximumScale: 1, userScalable: false
//   2. globals.css — html { touch-action: pan-x pan-y }
// On a release whose whole premise is that 239 type usages are 11px or
// smaller, preventing magnification is the sharpest possible contradiction.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const layout = readFileSync(join(process.cwd(), "src/app/layout.tsx"), "utf8");
const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

describe("pinch-zoom is not blocked", () => {
  it("the viewport export does not cap the scale", () => {
    expect(layout).not.toMatch(/maximumScale/);
  });

  it("the viewport export does not disable user scaling", () => {
    expect(layout).not.toMatch(/userScalable/);
  });

  // Sanity check first, so the assertion below cannot pass vacuously against
  // a file that has been moved or emptied.
  it("globals.css still declares an html rule", () => {
    expect(css).toMatch(/\bhtml\s*\{/);
  });

  // DELIBERATELY SCANS THE WHOLE FILE, not just the first `html {}` block.
  // An earlier version extracted that one block by regex, which passes green
  // if the rule is reintroduced inside a SECOND html block — a `@media`
  // block, say, which is exactly where the pull-to-refresh CSS already
  // lives, two rules below. That is a silent pass, the worst failure mode a
  // guard can have. `touch-action: pan*` anywhere in this stylesheet blocks
  // pinch-zoom on some element, so anywhere is what we check.
  it("nothing restricts touch-action to pan gestures", () => {
    const offenders = [...css.matchAll(/touch-action\s*:\s*pan[^;]*/g)].map(
      (m) => m[0]
    );
    expect(
      offenders,
      "touch-action: pan* blocks pinch-zoom (WCAG 1.4.4)"
    ).toEqual([]);
  });
});
