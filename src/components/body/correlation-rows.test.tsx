import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { CorrelationRows } from "./correlation-rows";
import type { TagInsight } from "@/lib/insights/correlations";

function insight(overrides: Partial<TagInsight>): TagInsight {
  return {
    emoji: "🍷",
    behavior: "Alcohol",
    auto: false,
    impactPct: -25,
    ciHalfWidthPct: 5,
    conclusive: true,
    events: 12,
    evidence: "strong",
    splits: { weekday: null, weekend: null },
    ...overrides,
  };
}

describe("CorrelationRows", () => {
  it("renders a conclusive effect in color", () => {
    const html = renderToString(
      <CorrelationRows insights={[insight({ conclusive: true, impactPct: -25 })]} />
    );
    expect(html).toContain("25% ± 5 next-day");
    expect(html).toContain("text-red-400");
  });

  it("renders strong evidence with no effect as a finding, not as unavailable", () => {
    const html = renderToString(
      <CorrelationRows
        insights={[insight({ conclusive: false, evidence: "strong", events: 30 })]}
      />
    );
    expect(html).toContain("No detectable effect");
  });

  it("renders limited evidence as calibrating, not as a finding", () => {
    const html = renderToString(
      <CorrelationRows
        insights={[insight({ conclusive: false, evidence: "limited", events: 3 })]}
      />
    );
    expect(html).toContain("Calibrating");
    expect(html).not.toContain("No detectable effect");
  });

  it("the two non-conclusive cases must not read alike", () => {
    const noEffect = renderToString(
      <CorrelationRows
        insights={[insight({ conclusive: false, evidence: "strong", events: 30 })]}
      />
    );
    const calibrating = renderToString(
      <CorrelationRows
        insights={[insight({ conclusive: false, evidence: "limited", events: 3 })]}
      />
    );
    // Check the badge styling specifically, not the shared header
    expect(noEffect).toContain("text-white/70");
    expect(noEffect).toContain("No detectable effect");
    expect(calibrating).toContain("text-white/40");
    expect(calibrating).toContain("Calibrating");
  });

  it("never renders the retired 'limited evidence' or 'inconclusive' strings", () => {
    const html = renderToString(
      <CorrelationRows
        insights={[
          insight({ conclusive: false, evidence: "strong", events: 30 }),
          insight({ conclusive: false, evidence: "limited", events: 3 }),
        ]}
      />
    );
    expect(html).not.toContain("inconclusive");
    expect(html).not.toContain("limited evidence");
  });
});
