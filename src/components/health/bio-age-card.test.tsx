import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { Figure } from "@/lib/uncertainty";
import type { BioAgeResult } from "@/lib/biological-age";
import { BioAgeCard } from "./bio-age-card";

const estimate: BioAgeResult = {
  bioAge: 34.2,
  deltaYears: -1.8,
  components: [{ key: "hrvMs", label: "HRV", offsetYears: -1.2 }],
};

describe("BioAgeCard", () => {
  it("renders the estimate and its components when available", () => {
    const html = renderToString(
      <BioAgeCard result={Figure.available(estimate, "high")} />
    );
    expect(html).toContain("34.2");
    expect(html).toContain("HRV");
  });

  it("names what's missing instead of inventing an estimate", () => {
    const html = renderToString(
      <BioAgeCard result={Figure.missingInput("Birth year, VO₂max")} />
    );
    expect(html).toContain("Needs Birth year, VO₂max");
    expect(html).not.toContain("34.2");
  });

  it("drops the headline but keeps the missing detail when hideHeadline is set", () => {
    const html = renderToString(
      <BioAgeCard result={Figure.missingInput("Birth year")} hideHeadline />
    );
    expect(html).not.toContain("Not enough inputs yet");
    expect(html).toContain("Needs Birth year");
  });
});
