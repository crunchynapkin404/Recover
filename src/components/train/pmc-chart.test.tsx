import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { PmcChart } from "./pmc-chart";

describe("PmcChart", () => {
  it("names the calibrating state instead of a bare sentence when fewer than 2 points exist", () => {
    const html = renderToString(
      <PmcChart wellness={[{ date: "2026-08-09", ctl: 12, atl: null }]} />
    );
    expect(html).toContain("Calibrating — day 1 of 2 days");
    expect(html).not.toContain("Not enough data yet for this range.");
  });

  it("draws the chart once at least 2 points exist", () => {
    const html = renderToString(
      <PmcChart
        wellness={[
          { date: "2026-08-08", ctl: 12, atl: 8 },
          { date: "2026-08-09", ctl: 13, atl: 9 },
        ]}
      />
    );
    expect(html).toContain("<svg");
    expect(html).not.toContain("Calibrating");
  });
});
