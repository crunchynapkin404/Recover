import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { ConfidenceChip } from "./confidence-chip";

describe("ConfidenceChip", () => {
  it("renders a label for low confidence", () => {
    const html = renderToString(<ConfidenceChip level="low" />);
    expect(html).toContain("Low confidence");
  });

  it("renders a label for medium confidence", () => {
    const html = renderToString(<ConfidenceChip level="medium" />);
    expect(html).toContain("Medium confidence");
  });

  it("renders nothing at high confidence", () => {
    const html = renderToString(<ConfidenceChip level="high" />);
    expect(html).toBe("");
  });
});
