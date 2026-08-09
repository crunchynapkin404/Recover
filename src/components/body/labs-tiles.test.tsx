import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { Figure } from "@/lib/uncertainty";
import type { BioAgeResult } from "@/lib/biological-age";
import { LabsTiles } from "./labs-tiles";

const estimate: BioAgeResult = {
  bioAge: 34.2,
  deltaYears: -1.8,
  components: [],
};

describe("LabsTiles", () => {
  it("renders the biological age when available", () => {
    const html = renderToString(
      <LabsTiles
        bioAge={Figure.available(estimate, "high")}
        biomarkerCount={3}
        lastDraw="2026-07-01"
      />
    );
    expect(html).toContain("34");
    expect(html).toContain("3 biomarkers");
  });

  it("names what's missing instead of a bare 'not enough inputs' sentence", () => {
    const html = renderToString(
      <LabsTiles
        bioAge={Figure.missingInput("Birth year, HRV")}
        biomarkerCount={0}
        lastDraw={null}
      />
    );
    expect(html).toContain("Needs Birth year, HRV");
    expect(html).not.toContain("34");
  });

  it("shows no draw recorded when lastDraw is null", () => {
    const html = renderToString(
      <LabsTiles
        bioAge={Figure.available(estimate, "high")}
        biomarkerCount={0}
        lastDraw={null}
      />
    );
    expect(html).toContain("no draw recorded");
  });
});
