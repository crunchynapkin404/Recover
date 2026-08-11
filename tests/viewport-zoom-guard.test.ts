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

  it("html does not restrict touch-action to pan gestures", () => {
    const htmlRule = css.match(/\bhtml\s*\{([\s\S]*?)\}/);
    expect(htmlRule, "no html rule found in globals.css").not.toBeNull();
    expect(htmlRule![1]).not.toMatch(/touch-action\s*:\s*pan/);
  });
});
