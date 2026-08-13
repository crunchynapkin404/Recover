import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { Figure } from "@/lib/uncertainty";
import { FitnessTiles, type FitnessTile } from "./fitness-tiles";

function tile(overrides: Partial<FitnessTile>): FitnessTile {
  return {
    label: "CTL",
    srLabel: "Fitness",
    value: Figure.available("62", "high"),
    color: "var(--chart-1)",
    context: null,
    ...overrides,
  };
}

describe("FitnessTiles", () => {
  it("renders an available value", () => {
    const html = renderToString(
      <FitnessTiles tiles={[tile({ value: Figure.available("62", "high") })]} />
    );
    expect(html).toContain("62");
  });

  it("renders a dash and a reason for a missing value", () => {
    const html = renderToString(
      <FitnessTiles
        tiles={[tile({ value: Figure.missingInput("training-load history") })]}
      />
    );
    expect(html).toContain("—");
    expect(html).toContain("Needs training-load history");
  });

  it("makes the missing-value reason available to screen readers, not only via title", () => {
    const html = renderToString(
      <FitnessTiles
        tiles={[tile({ value: Figure.missingInput("training-load history") })]}
      />
    );
    expect(html).toContain('class="sr-only"');
  });

  it("renders no sr-only reason for the value when it is available", () => {
    // The label's own sr-only srLabel span always renders; what must NOT
    // appear is a second sr-only span carrying an unavailable-value reason.
    const html = renderToString(
      <FitnessTiles tiles={[tile({ value: Figure.available("62", "high") })]} />
    );
    expect(html.match(/class="sr-only"/g)).toHaveLength(1);
  });

  it("still renders the context line for an available value", () => {
    const html = renderToString(
      <FitnessTiles
        tiles={[
          tile({
            value: Figure.available("62", "high"),
            context: "▲ +4 in 28d",
            contextColor: "var(--chart-2)",
          }),
        ]}
      />
    );
    expect(html).toContain("▲ +4 in 28d");
  });

  it("prints the short label and announces the full name", () => {
    const html = renderToString(
      <FitnessTiles
        tiles={[
          {
            label: "CTL",
            srLabel: "Fitness",
            value: Figure.available("62", "high"),
            color: "var(--chart-1)",
            context: "▲ +4 in 28d",
          },
        ]}
      />
    );
    expect(html).toContain(">CTL<");
    expect(html).toMatch(/<span class="sr-only">Fitness<\/span>/);
    // The redundant category word is not printed.
    expect(html).not.toContain("Fitness · CTL");
  });

  it("takes its colour from a token, not a hex literal", () => {
    const html = renderToString(
      <FitnessTiles
        tiles={[
          {
            label: "CTL",
            srLabel: "Fitness",
            value: Figure.available("62", "high"),
            color: "var(--chart-1)",
            context: "▲ +4 in 28d",
          },
        ]}
      />
    );
    expect(html).toMatch(/var\(--chart-1\)/);
    expect(html).not.toMatch(/#[0-9a-f]{6}/i);
  });

  it("uses the token scale, not ad-hoc sizes or white alphas", () => {
    const html = renderToString(
      <FitnessTiles
        tiles={[
          {
            label: "CTL",
            srLabel: "Fitness",
            value: Figure.available("62", "high"),
            color: "var(--chart-1)",
            context: "▲ +4 in 28d",
          },
        ]}
      />
    );
    expect(html).not.toMatch(/text-\[[\d.]+px\]/);
    expect(html).not.toMatch(/text-white\//);
    expect(html).not.toMatch(/bg-white\//);
    expect(html).not.toMatch(/border-white\//);
  });
});
