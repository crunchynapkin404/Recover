import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { Figure } from "@/lib/uncertainty";
import { VitalsGrid, type VitalTile } from "./vitals-grid";

function tile(overrides: Partial<VitalTile>): VitalTile {
  return {
    label: "HRV",
    value: Figure.available("62", "high"),
    unit: "ms",
    sparkPath: "",
    sparkClass: "stroke-chart-2",
    href: "/body?tab=trends",
    ...overrides,
  };
}

describe("VitalsGrid", () => {
  it("renders an available value with its unit", () => {
    const html = renderToString(
      <VitalsGrid tiles={[tile({ value: Figure.available("62", "high") })]} />
    );
    expect(html).toContain("62");
    expect(html).toContain("ms");
  });

  it("renders a dash and a reason for a missing reading", () => {
    const html = renderToString(
      <VitalsGrid
        tiles={[tile({ value: Figure.missingInput("an HRV reading") })]}
      />
    );
    expect(html).toContain("—");
    expect(html).toContain("Needs an HRV reading");
  });

  it("makes the missing-reading reason available to screen readers, not only via title", () => {
    const html = renderToString(
      <VitalsGrid
        tiles={[tile({ value: Figure.missingInput("an HRV reading") })]}
      />
    );
    expect(html).toContain('class="sr-only"');
  });

  it("renders no sr-only reason when the value is available", () => {
    const html = renderToString(
      <VitalsGrid tiles={[tile({ value: Figure.available("62", "high") })]} />
    );
    expect(html).not.toContain("sr-only");
  });

  it("still shows the unit next to a missing reading", () => {
    const html = renderToString(
      <VitalsGrid
        tiles={[
          tile({ value: Figure.missingInput("an HRV reading"), unit: "ms" }),
        ]}
      />
    );
    expect(html).toContain("ms");
  });

  it("renders a confidence chip on a low-confidence delta", () => {
    const html = renderToString(
      <VitalsGrid
        tiles={[
          tile({
            delta: { text: "0:45 tonight", tone: "warn", confidence: "low" },
          }),
        ]}
      />
    );
    expect(html).toContain("0:45 tonight");
    expect(html).toContain("Low confidence");
  });

  it("omits the confidence chip when the delta has no confidence set", () => {
    const html = renderToString(
      <VitalsGrid
        tiles={[tile({ delta: { text: "▲ 7d 58", tone: "good" } })]}
      />
    );
    expect(html).toContain("▲ 7d 58");
    expect(html).not.toContain("confidence");
  });

  it("uses the token type and ink scales", () => {
    const html = renderToString(<VitalsGrid tiles={[tile({})]} />);
    expect(html).toContain("text-label");
    expect(html).toMatch(/text-ink-(primary|secondary|muted)/);
    expect(html).not.toMatch(/text-white\//);
    expect(html).not.toMatch(/bg-white\//);
    expect(html).not.toMatch(/text-\[[\d.]+px\]/);
  });

  it("paints the sparkline with a token class, not a hex literal", () => {
    const html = renderToString(
      <VitalsGrid
        tiles={[
          tile({ sparkPath: "M0 10 L100 4", sparkClass: "stroke-chart-2" }),
        ]}
      />
    );
    expect(html).toContain("stroke-chart-2");
    expect(html).not.toMatch(/stroke="#/);
  });

  it("draws no sparkline at all when there is no path", () => {
    const html = renderToString(
      <VitalsGrid tiles={[tile({ sparkPath: "" })]} />
    );
    expect(html).not.toContain("<svg");
  });

  it("renders the numeric value in the numeric font", () => {
    const html = renderToString(<VitalsGrid tiles={[tile({})]} />);
    expect(html).toContain("font-numeric");
  });

  // C2, whole-branch review 2026-08-12: `lg:grid-cols-4` fired on viewport
  // width alone, but this grid sometimes sits in a much narrower container
  // (the morning state's 7fr column) than the viewport breakpoint assumes,
  // and four 12px tiles collided there. The fix is a container query, not a
  // viewport one — pinned here so a future edit can't quietly swap it back
  // for a `lg:`/`xl:` viewport breakpoint that would reintroduce the bug in
  // whichever narrow placement isn't in front of whoever's editing.
  it("switches to four columns by container width, not viewport width", () => {
    const html = renderToString(<VitalsGrid tiles={[tile({})]} />);
    expect(html).toContain("@container");
    expect(html).toContain("@min-[700px]:grid-cols-4");
    expect(html).not.toMatch(/\blg:grid-cols-4\b/);
    expect(html).not.toMatch(/\bxl:grid-cols-4\b/);
  });
});
