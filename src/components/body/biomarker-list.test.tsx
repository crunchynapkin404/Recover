import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { BiomarkerList, type BiomarkerRow } from "./biomarker-list";

const rows: BiomarkerRow[] = [
  {
    name: "ldl",
    displayName: "LDL",
    category: "lipids",
    value: 100,
    unit: "mg/dL",
    measuredAt: "2026-01-01",
    source: "manual",
    prevValue: null,
  },
];

describe("BiomarkerList", () => {
  it("shows an honest empty state when there are no rows", () => {
    const html = renderToString(<BiomarkerList rows={[]} />);
    expect(html).toContain(
      "No biomarkers yet — upload a blood test or add a reading."
    );
    expect(html).toContain('data-slot="empty-state"');
  });

  it("lists rows grouped by category when present", () => {
    const html = renderToString(<BiomarkerList rows={rows} />);
    expect(html).toContain("LDL");
    expect(html).not.toContain("No biomarkers yet");
  });
});
