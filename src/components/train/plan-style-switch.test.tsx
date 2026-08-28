import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { PlanStyleSwitch } from "./plan-style-switch";

const noop = () => {};

describe("PlanStyleSwitch", () => {
  it("renders both styles and the caption", () => {
    const html = renderToString(
      <PlanStyleSwitch effectiveStyle="balanced" action={noop} />
    );
    expect(html).toContain("Style");
    expect(html).toContain("Balanced");
    expect(html).toContain("Block-lite");
  });

  it("marks the effective style as pressed and disabled, not the other", () => {
    const html = renderToString(
      <PlanStyleSwitch effectiveStyle="block_lite" action={noop} />
    );
    expect(html).toContain('name="style" value="balanced"');
    expect(html).toContain('name="style" value="block_lite"');
    const balanced = /<button[^>]*>Balanced<\/button>/.exec(html);
    const blockLite = /<button[^>]*>Block-lite<\/button>/.exec(html);
    expect(balanced![0]).toContain('aria-pressed="false"');
    expect(blockLite![0]).toContain('aria-pressed="true"');
    expect(blockLite![0]).toContain("disabled");
    // The load-bearing half: EXACTLY one of the two carries `disabled` — not
    // both, not neither. A change that disabled both buttons (or neither)
    // must fail this, which a check of only the active button cannot catch.
    expect(balanced![0]).not.toContain("disabled");
    expect(html.match(/disabled=""/g) ?? []).toHaveLength(1);
  });

  // The chip trap (Task 7 shipped it once): active and inactive must
  // differ in FILL, not text colour alone. Fails if a future edit makes
  // the two segments' backgrounds identical.
  it("gives the active segment a fill the inactive segment does not have", () => {
    const html = renderToString(
      <PlanStyleSwitch effectiveStyle="balanced" action={noop} />
    );
    const activeButton = /<button[^>]*>Balanced<\/button>/.exec(html);
    const inactiveButton = /<button[^>]*>Block-lite<\/button>/.exec(html);
    expect(activeButton).not.toBeNull();
    expect(inactiveButton).not.toBeNull();

    expect(activeButton![0]).toMatch(/bg-surface-overlay/);
    expect(inactiveButton![0]).not.toMatch(/bg-surface-overlay/);
    expect(activeButton![0]).not.toBe(inactiveButton![0]);
  });

  it("has no type below the 12px floor and no ad-hoc white/black alphas", () => {
    const html = renderToString(
      <PlanStyleSwitch effectiveStyle="balanced" action={noop} />
    );
    expect(html).not.toMatch(/text-\[[\d.]+px\]/);
    expect(html).not.toMatch(/text-white\//);
    expect(html).not.toMatch(/bg-white\//);
    expect(html).not.toMatch(/border-white\//);
  });

  // This control now renders only inside the "plan-setup" sheet (slice 2
  // task 2), whose own panel is bg-surface-overlay. `bg-surface-raised`
  // resolves to the SAME #ffffff as that overlay in light mode — the
  // capsule's fill would go invisible against the sheet, leaving the chip
  // trap this component's own header comment warns about (active and
  // inactive segments told apart by text colour alone, since the active
  // segment's own bg-surface-overlay fill would ALSO match the sheet).
  // `bg-surface-selected` is the token this repo built for exactly this
  // shape — distinct from bg-surface-overlay in both themes.
  it("fills the capsule with surface-selected, not surface-raised (invisible on the sheet's own overlay)", () => {
    const html = renderToString(
      <PlanStyleSwitch effectiveStyle="balanced" action={noop} />
    );
    const capsule = /<div class="([^"]*)">/.exec(html);
    expect(capsule![1]).toContain("bg-surface-selected");
    expect(capsule![1]).not.toContain("bg-surface-raised");
  });
});
