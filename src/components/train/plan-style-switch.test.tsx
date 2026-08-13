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
    const balanced = /<button[^>]*>Balanced<\/button>/.exec(html);
    const blockLite = /<button[^>]*>Block-lite<\/button>/.exec(html);
    expect(balanced![0]).toContain('aria-pressed="false"');
    expect(blockLite![0]).toContain('aria-pressed="true"');
    expect(blockLite![0]).toContain("disabled");
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
});
