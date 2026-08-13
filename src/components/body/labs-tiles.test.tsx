import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { Figure } from "@/lib/uncertainty";
import type { BioAgeResult } from "@/lib/biological-age";
import { LabsHeadline, LabsTiles } from "./labs-tiles";

const estimate: BioAgeResult = {
  bioAge: 34.2,
  deltaYears: -1.8,
  components: [],
};

const estimateWithComponents: BioAgeResult = {
  bioAge: 34.2,
  deltaYears: -1.8,
  components: [{ key: "hrvMs", label: "HRV", offsetYears: -1.2 }],
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

  it("holds the floor — the tile eyebrows were 8.5px, the smallest on Labs", () => {
    const html = renderToString(
      <LabsTiles
        bioAge={Figure.available(estimate, "high")}
        biomarkerCount={3}
        lastDraw="2026-07-01"
      />
    );
    expect(html).not.toMatch(/text-\[\d/);
    expect(html).not.toContain("text-white/");
    expect(html).not.toContain("bg-white/");
  });
});

describe("LabsHeadline", () => {
  // F2 (v0.102 task 12, browser pass). LabsTiles' unavailable branch and
  // BioAgeCard's (hideHeadline) unavailable branch both call
  // unavailableMessage(bioAge) on the same Figure, so the identical
  // sentence rendered twice, adjacent, on the missing-input path.
  it("F2: prints the missing-inputs sentence exactly once when the estimate is unavailable", () => {
    const message = "Sleep consistency, VO₂max, Body fat, Birth year";
    const html = renderToString(
      <LabsHeadline
        bioAge={Figure.missingInput(message)}
        biomarkerCount={0}
        lastDraw={null}
      />
    );
    const sentence = `Needs ${message}`;
    const occurrences = html.split(sentence).length - 1;
    expect(occurrences, html).toBe(1);
  });

  it("F2: still shows both the estimate tile and the component breakdown when available", () => {
    const html = renderToString(
      <LabsHeadline
        bioAge={Figure.available(estimateWithComponents, "high")}
        biomarkerCount={3}
        lastDraw="2026-07-01"
      />
    );
    // The tile's own figure (LabsTiles).
    expect(html).toContain("34");
    // The breakdown component offset that drives it (BioAgeCard,
    // hideHeadline) — not duplication, since it's information the tile
    // does not carry.
    expect(html).toContain("HRV");
  });
});
