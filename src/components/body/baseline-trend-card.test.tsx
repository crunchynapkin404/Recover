import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { BaselineTrendCard } from "./baseline-trend-card";

const base = {
  title: "HRV vs baseline",
  tone: "recovery" as const,
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

  it("draws with a chart token, and the band with the same one at low opacity", () => {
    const html = renderToString(
      <BaselineTrendCard
        title="Resting HR"
        values={[48, 50, 49, 47]}
        band={{ low: 46, high: 52 }}
        tone="cardiac"
        unit="bpm"
      />
    );
    expect(html).toContain("var(--chart-1)");
    expect(html).toContain('fill-opacity="0.08"');
    // No raw colour survives anywhere in the output.
    expect(html).not.toMatch(/#[0-9a-fA-F]{6}/);
    expect(html).not.toContain("rgba(");
  });

  it("keeps 'against your baseline' in the accessible name once the visible suffix is cut", () => {
    const html = renderToString(
      <BaselineTrendCard
        title="Resting HR"
        values={[48, 50, 49, 47]}
        band={{ low: 46, high: 52 }}
        tone="cardiac"
        unit="bpm"
      />
    );
    expect(html).toContain("against your baseline");
    expect(html).toContain("currently 47bpm");
  });

  it("does not claim a baseline in the accessible name when there is no band", () => {
    const html = renderToString(
      <BaselineTrendCard
        title="Steps"
        values={[8000, 9000, 10000]}
        band={null}
        tone="output"
        unit=""
      />
    );
    expect(html).not.toContain("against your baseline");
  });

  it("holds the floor — the eyebrow was 9.5px and the reading 11px", () => {
    const html = renderToString(
      <BaselineTrendCard
        title="Weight"
        values={[72.1, 72.4]}
        band={null}
        tone="body"
        unit="kg"
        decimals={1}
      />
    );
    expect(html).toContain("label-micro");
    expect(html).not.toMatch(/text-\[\d/);
    expect(html).not.toContain("text-white/");
  });
});
