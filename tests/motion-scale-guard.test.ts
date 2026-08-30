// tests/motion-scale-guard.test.ts — Phase 6.4's guardrail.
//
// The premise, measured 2026-08-30 at d7b1e17: 83 CSS custom properties in
// globals.css, of which ZERO are a duration or an easing, against 11 spellings
// of 10 duration values and 8 distinct easings written by hand. `0.3s` and
// `300ms` both appear, for the same value, in a file that shipped as a design
// system.
//
// Modelled on tests/type-scale-guard.test.ts deliberately — same patterns
// module, same source scan, same two-sided OFFENDER_CEILINGS ratchet — so
// motion cannot become the one scale with no enforcement.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { CSS_PATH, readPrefixedThemeTokens } from "../src/lib/design/tokens";

const css = () => readFileSync(CSS_PATH, "utf8");

/**
 * Tailwind v4's OWN easing theme keys. Defining any of these in our @theme
 * block does not add a token — it REPOINTS the built-in utility of the same
 * name at our curve, silently changing every unmigrated `ease-out` in the app
 * from a foundations-only edit. globals.css records the identical trap for
 * --text-*: naming our scale steps `--text-sm` would have overridden every
 * call site still on Tailwind's default type scale.
 */
const TAILWIND_EASE_KEYS = [
  "--ease-in",
  "--ease-out",
  "--ease-in-out",
  "--ease-linear",
];

describe("the motion scale exists", () => {
  it("declares six durations and four easings", () => {
    const durations = readPrefixedThemeTokens(css(), "--duration-");
    const eases = readPrefixedThemeTokens(css(), "--ease-");
    expect(durations).toEqual({
      "--duration-feedback": "120ms",
      "--duration-motion": "200ms",
      "--duration-transition": "320ms",
      "--duration-reveal": "1200ms",
      "--duration-loop": "3s",
      "--duration-drift": "8s",
    });
    expect(eases).toEqual({
      "--ease-standard": "cubic-bezier(0.4, 0, 0.2, 1)",
      "--ease-settle": "cubic-bezier(0.21, 1.02, 0.49, 1)",
      "--ease-draw": "cubic-bezier(0.65, 0, 0.35, 1)",
      "--ease-spring": "cubic-bezier(0.34, 1.56, 0.64, 1)",
    });
  });

  it("takes no name Tailwind v4 already defines", () => {
    const ours = Object.keys(readPrefixedThemeTokens(css(), "--ease-"));
    const collisions = ours.filter((t) => TAILWIND_EASE_KEYS.includes(t));
    expect(
      collisions,
      `these token names are Tailwind v4 built-ins — declaring them ` +
        `repoints every existing call site using that utility instead of ` +
        `adding a token. Rename (e.g. --ease-settle, not --ease-out).`
    ).toEqual([]);
  });

  it("writes every duration in one unit, so two spellings cannot mean one value", () => {
    const values = Object.values(readPrefixedThemeTokens(css(), "--duration-"));
    // The bug this pins: globals.css shipped both `0.3s` and `300ms`.
    // Sub-second durations are ms, second-and-over are s, and nothing is
    // written two ways.
    for (const v of values) {
      expect(v, `"${v}" must be an integer ms or whole-second value`).toMatch(
        /^(\d+ms|\d+s)$/
      );
    }
  });
});
