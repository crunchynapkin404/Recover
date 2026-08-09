import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { Figure } from "@/lib/uncertainty";
import { FitnessTiles, type FitnessTile } from "./fitness-tiles";

function tile(overrides: Partial<FitnessTile>): FitnessTile {
  return {
    label: "Fitness · CTL",
    value: Figure.available("62", "high"),
    color: "#60a5fa",
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

  it("renders no sr-only reason when the value is available", () => {
    const html = renderToString(
      <FitnessTiles tiles={[tile({ value: Figure.available("62", "high") })]} />
    );
    expect(html).not.toContain("sr-only");
  });

  it("still renders the context line for an available value", () => {
    const html = renderToString(
      <FitnessTiles
        tiles={[
          tile({
            value: Figure.available("62", "high"),
            context: "▲ +4 in 28d",
            contextColor: "#34d399",
          }),
        ]}
      />
    );
    expect(html).toContain("▲ +4 in 28d");
  });
});
