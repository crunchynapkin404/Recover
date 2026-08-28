import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { SeasonModeSwitch } from "./season-mode-switch";

const noop = () => {};

describe("SeasonModeSwitch", () => {
  it("renders both modes and the caption", () => {
    const html = renderToString(
      <SeasonModeSwitch
        effectiveSeasonMode="normal"
        reentryStage="none"
        action={noop}
      />
    );
    expect(html).toContain("Season");
    expect(html).toContain("Normal");
    expect(html).toContain("Off-season");
  });

  it("offers re-entry only once off-season with no re-entry started yet", () => {
    const off = renderToString(
      <SeasonModeSwitch
        effectiveSeasonMode="off_season"
        reentryStage="none"
        action={noop}
      />
    );
    expect(off).toContain("Start re-entry");

    const normal = renderToString(
      <SeasonModeSwitch
        effectiveSeasonMode="normal"
        reentryStage="none"
        action={noop}
      />
    );
    expect(normal).not.toContain("Start re-entry");
  });

  it("names the active re-entry week instead of the start control", () => {
    const html = renderToString(
      <SeasonModeSwitch
        effectiveSeasonMode="off_season"
        reentryStage="week_1"
        action={noop}
      />
    );
    expect(html).toContain("Re-entry week 1");
    expect(html).not.toContain("Start re-entry");
  });

  // The chip trap (Task 7 shipped it once): a selection control's active
  // segment must differ from its inactive segment in FILL, not text colour
  // alone. This fails if a future edit makes the two segments' backgrounds
  // identical (e.g. giving inactive `bg-surface-overlay` too, or dropping
  // it from active) — asymmetric by construction, not just "not equal".
  it("gives the active segment a fill the inactive segment does not have", () => {
    const html = renderToString(
      <SeasonModeSwitch
        effectiveSeasonMode="normal"
        reentryStage="none"
        action={noop}
      />
    );
    const activeButton = /<button[^>]*>Normal<\/button>/.exec(html);
    const inactiveButton = /<button[^>]*>Off-season<\/button>/.exec(html);
    expect(activeButton).not.toBeNull();
    expect(inactiveButton).not.toBeNull();

    expect(activeButton![0]).toMatch(/bg-surface-overlay/);
    expect(inactiveButton![0]).not.toMatch(/bg-surface-overlay/);
    // And they are not, in fact, the same markup.
    expect(activeButton![0]).not.toBe(inactiveButton![0]);
  });

  it("has no type below the 12px floor and no ad-hoc white/black alphas", () => {
    const html = renderToString(
      <SeasonModeSwitch
        effectiveSeasonMode="off_season"
        reentryStage="week_2"
        action={noop}
      />
    );
    expect(html).not.toMatch(/text-\[[\d.]+px\]/);
    expect(html).not.toMatch(/text-white\//);
    expect(html).not.toMatch(/bg-white\//);
    expect(html).not.toMatch(/border-white\//);
    // Not just the alpha-utility guard's blind spot — the raw palette
    // colour this component carried before migration.
    expect(html).not.toMatch(/emerald/);
  });

  // This control now renders only inside the "plan-setup" sheet (slice 2
  // task 2), whose own panel is bg-surface-overlay. `bg-surface-raised`
  // resolves to the SAME #ffffff as that overlay in light mode — the
  // capsule's fill would go invisible against the sheet, leaving the chip
  // trap the test above guards against (active/inactive told apart by text
  // colour alone, since the active segment's own bg-surface-overlay fill
  // would ALSO match the sheet). `bg-surface-selected` is the token this
  // repo built for exactly this shape — distinct from bg-surface-overlay
  // in both themes.
  it("fills the capsule with surface-selected, not surface-raised (invisible on the sheet's own overlay)", () => {
    const html = renderToString(
      <SeasonModeSwitch
        effectiveSeasonMode="normal"
        reentryStage="none"
        action={noop}
      />
    );
    // Matches on the capsule's own distinguishing classes, not "the first
    // div" (review finding 4 on ded5f64) — a match on any div silently
    // retargets to whatever wrapper lands first in a future markup change.
    const capsule = /<div class="([^"]*\brounded-full border[^"]*)">/.exec(
      html
    );
    expect(capsule![1]).toContain("bg-surface-selected");
    expect(capsule![1]).not.toContain("bg-surface-raised");
  });
});
