// tests/contrast-guard.test.ts — Phase 2b.4's first guardrail
// (docs/specs/2026-08-11-2b4-visual-redesign-design.md).
//
// The premise of v0.99.0 is that 134 ink usages measured between 2.6:1 and
// 3.8:1 — below the 4.5:1 AA floor — because nothing ever checked. This is
// the check. It reads the tokens out of the CSS that ships, so it cannot
// pass against a stale copy of the palette.
//
// WORST CASE, NOT BEST CASE: each ink is asserted against every surface it
// is allowed to appear on, so a token that only passes on the most flattering
// background fails here. The light `hairline` was #949494 in the approved
// design and measured 2.81:1 against surface-base; this guard is why it is
// #8a8a8a.
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { contrastRatio } from "../src/lib/design/contrast";
import {
  CSS_PATH,
  readTokenSets,
  GOVERNED,
  type TokenSet,
} from "../src/lib/design/tokens";

const SURFACES = ["surface-base", "surface-raised", "surface-overlay"] as const;

/** Inks legal on text, and the floor each must clear on every surface. */
const TEXT_INKS = [
  "ink-primary",
  "ink-secondary",
  "ink-muted",
  "accent",
] as const;
const TEXT_FLOOR = 4.5; // WCAG 2.2 SC 1.4.3, normal text

/** Non-text ink: dividers, borders, icon strokes. */
const NON_TEXT_FLOOR = 3.0; // WCAG 2.2 SC 1.4.11

describe("contrast guard", () => {
  const sets = readTokenSets();

  for (const [themeName, tokens] of Object.entries(sets) as [
    string,
    TokenSet,
  ][]) {
    describe(themeName, () => {
      for (const ink of TEXT_INKS) {
        for (const surface of SURFACES) {
          it(`${ink} on ${surface} clears ${TEXT_FLOOR}:1`, () => {
            const ratio = contrastRatio(tokens[ink], tokens[surface]);
            expect(
              ratio,
              `${themeName}: --${ink} (${tokens[ink]}) on --${surface} ` +
                `(${tokens[surface]}) is ${ratio.toFixed(2)}:1`
            ).toBeGreaterThanOrEqual(TEXT_FLOOR);
          });
        }
      }

      for (const surface of SURFACES) {
        it(`hairline on ${surface} clears ${NON_TEXT_FLOOR}:1`, () => {
          const ratio = contrastRatio(tokens["hairline"], tokens[surface]);
          expect(
            ratio,
            `${themeName}: --hairline (${tokens["hairline"]}) on ` +
              `--${surface} (${tokens[surface]}) is ${ratio.toFixed(2)}:1`
          ).toBeGreaterThanOrEqual(NON_TEXT_FLOOR);
        });
      }
    });
  }

  it("governs every ink and surface token the CSS declares", () => {
    // A new --ink-* or --surface-* added to globals.css but not to GOVERNED
    // would ship unchecked. This reads the CSS directly rather than comparing
    // two objects both built FROM GOVERNED — that comparison can never fail,
    // and a guard that cannot fail is the defect this release is about.
    const css = readFileSync(CSS_PATH, "utf8");
    const rootBlock = css.match(/^:root\s*\{([\s\S]*?)^\}/m)![1];
    const declared = [
      ...rootBlock.matchAll(/--((?:ink|surface)-[a-z]+|hairline|accent):/g),
    ].map((m) => m[1]);
    const ungoverned = declared.filter(
      (t) => !(GOVERNED as readonly string[]).includes(t)
    );
    expect(
      ungoverned,
      "add these to GOVERNED in src/lib/design/tokens.ts or they ship unchecked"
    ).toEqual([]);
  });
});
