import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { BaselineTrendCard } from "./baseline-trend-card";

const base = {
  title: "HRV vs baseline",
  color: "#10b981",
  bandFill: "rgba(16,185,129,0.08)",
  unit: "ms",
};

describe("BaselineTrendCard", () => {
  it("shows the latest reading and the band as mean ± half-width", () => {
    const html = renderToString(
      <BaselineTrendCard
        {...base}
        values={[60, 62, 64]}
        band={{ low: 61, high: 69 }}
      />
    );
    expect(html).toContain("64");
    expect(html).toContain("ms");
    expect(html).toContain("65"); // (61 + 69) / 2
    expect(html).toContain("4"); // (69 - 61) / 2
  });

  it("draws the band rect and its dashed centreline when a baseline exists", () => {
    const html = renderToString(
      <BaselineTrendCard
        {...base}
        values={[60, 62, 64]}
        band={{ low: 61, high: 69 }}
      />
    );
    expect(html).toContain("<rect");
    expect(html).toContain("stroke-dasharray");
  });

  it("omits the band entirely while baselines are calibrating", () => {
    const html = renderToString(
      <BaselineTrendCard {...base} values={[60, 62, 64]} band={null} />
    );
    expect(html).not.toContain("<rect");
    expect(html).toContain("<polyline");
  });

  it("says so rather than drawing a line through one point", () => {
    const html = renderToString(
      <BaselineTrendCard {...base} values={[null, 62, null]} band={null} />
    );
    expect(html).toContain("Not enough readings");
    expect(html).not.toContain("<polyline");
  });

  it("ignores gaps instead of plotting them as zero", () => {
    const html = renderToString(
      <BaselineTrendCard
        {...base}
        values={[60, null, 64]}
        band={{ low: 61, high: 69 }}
      />
    );
    // Three points, one missing: the polyline carries two coordinate pairs.
    const points = /points="([^"]*)"/.exec(html)?.[1] ?? "";
    expect(points.split(" ").filter(Boolean)).toHaveLength(2);
  });

  it("keeps the band inside the viewport when it sits outside the series", () => {
    const html = renderToString(
      <BaselineTrendCard
        {...base}
        values={[100, 102, 104]}
        band={{ low: 40, high: 50 }}
      />
    );
    const y = Number(/<rect[^>]*y="([\d.]+)"/.exec(html)?.[1]);
    const h = Number(/<rect[^>]*height="([\d.]+)"/.exec(html)?.[1]);
    expect(y).toBeGreaterThanOrEqual(0);
    expect(y + h).toBeLessThanOrEqual(90);
  });
});
