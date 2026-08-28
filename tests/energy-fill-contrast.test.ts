// The hole tests/contrast-guard.test.ts structurally cannot cover, for the
// one place this branch opens it: --accent as a FILL with text on top.
//
// roleOfToken() classifies `accent` as "text", so the sibling guard measures
// it as ink against every surface and never as a ground under ink. The
// availability timeline paints pills in three densities of accent and writes
// the block's duration inside them, so the composited fill is a real text
// background — and an opaque bg-accent fails AA under --ink-primary in BOTH
// themes (~3.3:1 light, ~2.0:1 dark). That is why the scale is capped.
import { describe, expect, it } from "vitest";
import { ENERGY_ALPHA } from "../src/lib/availability/energy-fill";
import { compositeOver } from "../src/lib/design/color-literals";
import { contrastRatio, hexToRgb } from "../src/lib/design/contrast";
import { resolvedThemeTokens, type ThemeName } from "../src/lib/design/tokens";
import { ENERGY_CEILING } from "../src/lib/availability/types";

const THEMES: ThemeName[] = ["light", "dark"];
const AA_TEXT = 4.5;

/**
 * The ground the pills actually sit on: IntakeForm's own card is
 * `bg-surface-selected`, inside the availability sheet's overlay panel.
 */
const GROUND = "surface-selected";

describe("energy fill scale", () => {
  const tokens = resolvedThemeTokens();

  it("covers exactly the energies the model admits", () => {
    expect(Object.keys(ENERGY_ALPHA).sort()).toEqual(
      Object.keys(ENERGY_CEILING).sort()
    );
  });

  it("is a strictly increasing density, so energy is legible as weight", () => {
    expect(ENERGY_ALPHA.easy).toBeLessThan(ENERGY_ALPHA.normal);
    expect(ENERGY_ALPHA.normal).toBeLessThan(ENERGY_ALPHA.full);
  });

  for (const theme of THEMES) {
    for (const [energy, alpha] of Object.entries(ENERGY_ALPHA)) {
      it(`clears AA for --ink-primary on ${energy} in ${theme}`, () => {
        const [r, g, b] = hexToRgb(tokens[theme].accent);
        const fill = compositeOver([r, g, b, alpha], tokens[theme][GROUND]);
        expect(contrastRatio(tokens[theme]["ink-primary"], fill)).toBeGreaterThanOrEqual(
          AA_TEXT
        );
      });
    }
  }

  // The reason the scale is capped rather than running to a solid accent —
  // pinned so a later "make full gas bolder" edit fails here instead of on a
  // phone. If this test ever passes, --accent has changed and the cap can be
  // revisited.
  it("records that an opaque accent fill would fail, in both themes", () => {
    for (const theme of THEMES) {
      const [r, g, b] = hexToRgb(tokens[theme].accent);
      const fill = compositeOver([r, g, b, 1], tokens[theme][GROUND]);
      expect(contrastRatio(tokens[theme]["ink-primary"], fill)).toBeLessThan(
        AA_TEXT
      );
    }
  });
});
