// The hole tests/contrast-guard.test.ts structurally cannot cover, for the
// two places this branch opens it: --accent as a FILL, and --accent as the
// BOUNDARY that makes a graphical object findable.
//
// roleOfToken() classifies `accent` as "text", so the sibling guard measures
// it as ink against every surface and never as either of those.
//
// WHAT IS LOAD-BEARING TODAY (the 1.4.11 block below). The pill carries no
// painted text: the browser capture showed that at the 44px floor a duration
// renders as "1h 00…", so the numbers moved to the day summary line and the
// pill became a mark. A mark still has to be perceivable, and at the lightest
// density its fill is nearly the card's own colour — so its BORDER is what
// finds it, and WCAG 1.4.11's 3:1 applies to that border against the card.
//
// WHAT IS A RETAINED CAP, NOT AN ACTIVE CONSTRAINT (the AA block below).
// Nothing sits on these fills right now. The cap is kept because it is the
// reason the scale stops at /60 rather than running to a solid accent, and
// because a label returning is a one-line change that would otherwise
// reintroduce ~3.3:1 in light and ~2.0:1 in dark with no test to say so.
// Recorded as what it is rather than deleted or dressed up as active.
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

  // WCAG 1.4.11, and the assertion that actually guards what ships: the pill
  // is a meaningful graphical object, and its border is what separates it
  // from the card it sits on.
  for (const theme of THEMES) {
    it(`the pill's accent border clears 3:1 against the card in ${theme}`, () => {
      expect(
        contrastRatio(tokens[theme].accent, tokens[theme][GROUND])
      ).toBeGreaterThanOrEqual(3);
    });
  }

  for (const theme of THEMES) {
    for (const [energy, alpha] of Object.entries(ENERGY_ALPHA)) {
      it(`keeps AA headroom for --ink-primary on ${energy} in ${theme}`, () => {
        const [r, g, b] = hexToRgb(tokens[theme].accent);
        const fill = compositeOver([r, g, b, alpha], tokens[theme][GROUND]);
        expect(
          contrastRatio(tokens[theme]["ink-primary"], fill)
        ).toBeGreaterThanOrEqual(AA_TEXT);
      });
    }
  }

  // The reason the scale is capped rather than running to a solid accent.
  // If this test ever starts passing, --accent has changed and the cap can
  // be revisited on purpose rather than by drift.
  it("records that an opaque accent fill would fail AA, in both themes", () => {
    for (const theme of THEMES) {
      const [r, g, b] = hexToRgb(tokens[theme].accent);
      const fill = compositeOver([r, g, b, 1], tokens[theme][GROUND]);
      expect(contrastRatio(tokens[theme]["ink-primary"], fill)).toBeLessThan(
        AA_TEXT
      );
    }
  });
});
