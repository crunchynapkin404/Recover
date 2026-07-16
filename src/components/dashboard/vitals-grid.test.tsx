import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { VitalsGrid } from "./vitals-grid";

/**
 * Companion to the sparkPath honesty fix: an empty path means "not enough
 * data for a trend", and the grid must render no sparkline at all — an SVG
 * with `d=""` would still occupy the slot and imply a chart exists.
 * The trend icons are themselves SVGs, so these assertions key on the
 * sparkline's own viewBox rather than counting <path> elements.
 */
const tile = (sparkPath: string) => ({
  label: "HRV",
  value: "62",
  unit: "ms",
  avg7d: null,
  trend: "flat" as const,
  trendGood: true,
  sparkPath,
  sparkColor: "#10b981",
});

const SPARK_SVG = 'viewBox="0 0 100 20"';

describe("vitals grid sparkline", () => {
  it("renders the sparkline when a real path is given", () => {
    const html = renderToString(
      <VitalsGrid tiles={[tile("M0.0 18.0 L100.0 2.0")]} />,
    );
    expect(html).toContain(SPARK_SVG);
    expect(html).toContain('d="M0.0 18.0 L100.0 2.0"');
  });

  it("renders no sparkline SVG for an empty path", () => {
    const html = renderToString(<VitalsGrid tiles={[tile("")]} />);
    expect(html).not.toContain(SPARK_SVG);
  });

  it("keeps the sparkline slot so tiles stay aligned", () => {
    const html = renderToString(<VitalsGrid tiles={[tile("")]} />);
    expect(html).toContain("h-8");
  });
});
