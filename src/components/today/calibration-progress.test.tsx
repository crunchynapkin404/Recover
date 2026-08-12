import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { CalibrationProgress } from "./calibration-progress";

const props = {
  daysWithSignal: 4,
  target: 14,
  prompt: "Log an HRV reading tomorrow morning.",
};

describe("CalibrationProgress", () => {
  it("renders the honest day count and the prompt", () => {
    const html = renderToString(<CalibrationProgress {...props} />);
    // renderToString inserts a hydration-safe <!-- --> between adjacent
    // text/expression siblings (React 19); same convention as the
    // "30<!-- -->%" assertion in body-battery.test.tsx.
    expect(html).toContain("Day <!-- -->4");
    expect(html).toContain("of <!-- -->14");
    expect(html).toContain("Log an HRV reading tomorrow morning.");
  });

  // v0.100.1 REVERSED one clause of this test, on owner feedback. It used to
  // require `bg-surface-raised` and forbid `glass`, encoding slice 0's rule
  // that glass stops being a substrate. On the live dark app that left the
  // page flat while the sheets stacked on it stayed frosted, so page-flow
  // cards are back on `.glass` — the same material 44 component files across
  // every other surface already use.
  //
  // Everything this test actually protects is unchanged: no ad-hoc white
  // alphas, no ink outside the ramp, nothing below the floor. The glass fill
  // itself is held to the 4.5:1 text floor by tests/glass-contrast-guard.ts,
  // which composites it over each ground it can sit on.
  it("uses the token surface and ink scale, not ad-hoc white alphas", () => {
    const html = renderToString(<CalibrationProgress {...props} />);
    expect(html).toContain("glass");
    expect(html).toMatch(/text-ink-(primary|secondary|muted)/);
    expect(html).not.toMatch(/text-white\//);
    expect(html).not.toMatch(/bg-white\//);
  });

  it("has no type below the 12px floor", () => {
    const html = renderToString(<CalibrationProgress {...props} />);
    expect(html).not.toMatch(/text-\[[\d.]+px\]/);
    expect(html).not.toMatch(/\btext-xs\b/);
  });

  it("keeps the progressbar accessible", () => {
    const html = renderToString(<CalibrationProgress {...props} />);
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="4"');
    expect(html).toContain('aria-valuemax="14"');
  });

  it("reports 0% without dividing by zero when the target is zero", () => {
    const html = renderToString(
      <CalibrationProgress {...props} target={0} daysWithSignal={0} />
    );
    expect(html).toContain("width:0%");
  });
});
