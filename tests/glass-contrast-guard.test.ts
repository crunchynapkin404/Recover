// tests/glass-contrast-guard.test.ts — the hole tests/contrast-guard.test.ts
// structurally cannot cover.
//
// That guard governs OPAQUE grounds: it reads every `--surface-*` token and
// checks each text ink against it. `--glass-bg` is not a surface token and is
// not opaque, so nothing checked it — and from v0.100.1 it is once again the
// substrate Today's blocks actually sit on, which makes it the background a
// large share of the app's text is really rendered against.
//
// A translucent fill has no single colour to measure. It has a RANGE, decided
// by whatever shows through. So this composites the fill over every opaque
// ground it can plausibly sit on and takes the worst result, which is the
// same worst-case methodology the sibling guard uses for surfaces.
//
// WHY THIS IS NOT PARANOIA. The whole 2b.4 release exists to put a 4.5:1
// floor under this app's text. Re-introducing a substrate that no guard reads
// would mean the one surface most of that text sits on is the single surface
// exempt from the rule — and v0.99.0 already shipped exactly that shape of
// mistake twice (a guard reading only the first of six token blocks; an AA
// argument true for utilities and false for inline styles).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compositeOver, type Rgba } from "../src/lib/design/color-literals";
import { contrastRatio } from "../src/lib/design/contrast";
import {
  CSS_PATH,
  readDeclarations,
  resolvedThemeTokens,
  roleOfToken,
  type ThemeName,
} from "../src/lib/design/tokens";

const THEMES: ThemeName[] = ["light", "dark"];

// `readCss` (the helper `resolvedThemeTokens` uses internally) is not
// exported from tokens.ts, so this reads the file the same way
// tests/contrast-guard.test.ts does: CSS_PATH + readFileSync.
function declaredTokenNames(): string[] {
  return readDeclarations(readFileSync(CSS_PATH, "utf8")).map((d) => d.token);
}

/**
 * Every text ink, DERIVED. This was a hand-written array through v0.100.1,
 * which meant adding an ink token silently skipped the glass check while
 * passing the surface check — the same shape as the guard that read only
 * the first of six token blocks. Every token the shared classifier calls
 * `"text"` is checked over glass here, with no hand-written exemptions: a
 * hand-written exemption is exactly the failure mode this derivation exists
 * to remove. That includes `accent` (used as text — badges, links, the
 * "+ Add race" summary — and it does render on glass) and suffix-style ink
 * names like `coach-ink`, not just prefix-style `ink-*`.
 */
const TEXT_INKS = [...new Set(declaredTokenNames())]
  .filter((t) => roleOfToken(t) === "text")
  .sort();

it("derives its ink list from the stylesheet, not from a hand-written array", () => {
  // Exact inventory, not a floor: a floor lets a new text token silently go
  // unchecked, which is the bug this file exists to fix. If this fails
  // because a token was added or removed, confirm the new/changed token
  // clears the 4.5:1 glass floor above, then update this list — never
  // loosen it back to a length check.
  expect(TEXT_INKS).toEqual([
    "accent",
    "coach-ink",
    "ink-muted",
    "ink-primary",
    "ink-race",
    "ink-secondary",
    "viz-muted-ink",
  ]);
});

/**
 * The opaque grounds glass ACTUALLY sits on, verified against the tree rather
 * than guessed: `.mesh-gradient` paints `--surface-base`, which is the page
 * flow every glass card lives in, and `--surface-raised` covers glass nested
 * in a raised card.
 *
 * `--surface-overlay` is deliberately NOT here, and not because it fails —
 * see the recorded-prohibition test at the bottom, which pins the number and
 * the reason. Overlay is used for tiles rendered INSIDE cards (stat tiles,
 * the cost line, the progress track), i.e. it stacks on top of glass, never
 * under it.
 */
const GROUNDS = ["surface-base", "surface-raised"] as const;

const TEXT_FLOOR = 4.5;

/** `rgba(255, 255, 255, 0.72)` / `rgba(255,255,255,.05)` → [r,g,b,a]. */
function parseRgba(value: string): Rgba | null {
  const m =
    /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,/\s]+([\d.]+))?\s*\)$/.exec(
      value.trim()
    );
  if (!m) return null;
  return [
    Number(m[1]),
    Number(m[2]),
    Number(m[3]),
    m[4] === undefined ? 1 : Number(m[4]),
  ];
}

describe("glass contrast guard", () => {
  it("reads a --glass-bg for every theme", () => {
    for (const theme of THEMES) {
      const tokens = resolvedThemeTokens()[theme];
      expect(
        tokens["glass-bg"],
        `${theme} defines no --glass-bg, so this guard would silently check ` +
          `nothing — the exact failure mode it exists to prevent`
      ).toBeTruthy();
    }
  });

  it("holds every text ink to 4.5:1 on glass, over every ground, in both themes", () => {
    for (const theme of THEMES) {
      const tokens = resolvedThemeTokens()[theme];
      const fill = parseRgba(tokens["glass-bg"]);

      // An opaque --glass-bg is legal (it is what light shipped before
      // v0.100.1) and is simply checked as-is.
      for (const ground of GROUNDS) {
        const composited =
          fill && fill[3] < 1
            ? compositeOver(fill, tokens[ground])
            : tokens["glass-bg"].startsWith("#")
              ? tokens["glass-bg"]
              : tokens[ground];

        for (const ink of TEXT_INKS) {
          const ratio = contrastRatio(tokens[ink], composited);
          expect(
            ratio,
            `${ink} on glass over ${ground} in ${theme} is ${ratio.toFixed(2)}:1 ` +
              `(glass ${tokens["glass-bg"]} composites to ${composited}). ` +
              `Text needs ${TEXT_FLOOR}:1. Either raise the glass alpha so the ` +
              `composite lands nearer its surface, or stop putting text on glass.`
          ).toBeGreaterThanOrEqual(TEXT_FLOOR);
        }
      }
    }
  });

  /**
   * A recorded prohibition, not an exemption.
   *
   * Dark glass over `--surface-overlay` composites to #2a2a2a, where
   * `--ink-muted` lands at ~4.16:1 — under the floor. No such stacking exists
   * today (overlay is used for tiles inside cards, never as a ground beneath
   * glass), so the guard above does not check it. This test exists so the
   * reason is written down and measured rather than lost: if you ever nest a
   * glass element on an overlay ground, muted text on it is illegal, and the
   * fix is to lower the dark glass alpha rather than to widen this file.
   *
   * It also fails if that number ever improves enough to make the stacking
   * legal, which is the signal to allow it deliberately.
   */
  it("records why glass may not sit on an overlay ground in dark", () => {
    const dark = resolvedThemeTokens().dark;
    const fill = parseRgba(dark["glass-bg"])!;
    const composited = compositeOver(fill, dark["surface-overlay"]);
    const ratio = contrastRatio(dark["ink-muted"], composited);
    expect(
      ratio,
      `dark glass over surface-overlay now measures ${ratio.toFixed(2)}:1 for ` +
        `ink-muted. If this has risen past ${TEXT_FLOOR}, the stacking is no ` +
        `longer illegal — add "surface-overlay" to GROUNDS and delete this test.`
    ).toBeLessThan(TEXT_FLOOR);
  });

  /**
   * A recorded DEFERRAL, with the number that justifies it.
   *
   * Light glass is still opaque, and that is deliberate as of v0.100.1.
   * Making it translucent was tried and measured: the axe pass went from 378
   * confirmed / 1559 indeterminate to 8 / 2372. Those 370 findings were not
   * fixed, they became uncomputable — axe cannot resolve contrast through a
   * translucent background, and `indeterminate` never gates the exit code.
   * Slices 2-8 would have inherited a gate that reports almost nothing.
   *
   * Slice 9 lifts `forcedTheme="dark"`, which is the first moment light mode
   * is reachable by anyone. It should set this to rgba(255,255,255,0.72) —
   * already verified above to clear the text floor on every ground — and
   * re-baseline axe in the same commit.
   *
   * This test fails the moment someone makes light glass translucent without
   * that re-baselining, which is the point.
   */
  it("keeps light glass opaque until slice 9 re-baselines axe", () => {
    const light = resolvedThemeTokens().light["glass-bg"];
    expect(
      parseRgba(light)?.[3] ?? 1,
      `light --glass-bg is "${light}". Translucent light glass moves ~370 axe ` +
        `findings from confirmed to indeterminate, which silently disarms the ` +
        `exit-code gate for every remaining slice. If this is slice 9 and you ` +
        `are re-baselining deliberately, delete this test and say so in the ` +
        `commit message.`
    ).toBe(1);
  });
});
