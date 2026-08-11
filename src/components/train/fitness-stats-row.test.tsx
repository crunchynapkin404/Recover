import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { FitnessStatsRow, rampTrendLabel } from "./fitness-stats-row";

describe("rampTrendLabel", () => {
  it("labels a rising ramp rate as Ramping", () => {
    expect(rampTrendLabel(5)).toBe("Ramping ↑");
  });

  it("labels a falling ramp rate as Tapering", () => {
    expect(rampTrendLabel(-5)).toBe("Tapering ↓");
  });

  it("labels a near-zero ramp rate as Steady", () => {
    expect(rampTrendLabel(0.4)).toBe("Steady");
  });

  it("returns null when there is no ramp rate", () => {
    expect(rampTrendLabel(null)).toBeNull();
  });
});

describe("FitnessStatsRow", () => {
  it("renders nothing when given no stats", () => {
    const html = renderToString(<FitnessStatsRow stats={[]} />);
    expect(html).toBe("");
  });

  it("renders one column per stat and each label/value", () => {
    const html = renderToString(
      <FitnessStatsRow
        stats={[
          { label: "eFTP", value: "265W" },
          { label: "Max Power", value: "1509W" },
        ]}
      />
    );
    expect(html).toContain("grid-cols-2");
    expect(html).toContain("eFTP");
    expect(html).toContain("265W");
    expect(html).toContain("Max Power");
    expect(html).toContain("1509W");
  });
});
