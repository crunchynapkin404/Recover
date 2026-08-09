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
    sparkColor: "#10b981",
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
});
