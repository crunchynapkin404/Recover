import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { ArtifactCard } from "./artifact-card";
import type { ChartSpec } from "@/lib/tools/render-chart";

const lineSample: ChartSpec = {
  type: "line",
  title: "CTL trend",
  series: [
    {
      label: "CTL",
      style: "solid",
      data: [
        { x: 1, y: 60 },
        { x: 2, y: 65 },
        { x: 3, y: 70 },
        { x: 4, y: 68 },
      ],
    },
  ],
};

const barSample: ChartSpec = {
  type: "bar",
  title: "Weekly load",
  series: [
    {
      label: "Load",
      style: "solid",
      data: [
        { x: "Mon", y: 120 },
        { x: "Tue", y: 0 },
        { x: "Wed", y: 85 },
        { x: "Thu", y: 140 },
        { x: "Fri", y: 60 },
      ],
    },
  ],
};

const tableSample: ChartSpec = {
  type: "table",
  title: "Best efforts",
  series: [
    {
      label: "Effort",
      style: "solid",
      data: [
        { x: "5k", y: 1260 },
        { x: "10k", y: 2700 },
      ],
    },
  ],
};

describe("ArtifactCard", () => {
  it("renders title", () => {
    const html = renderToString(<ArtifactCard spec={lineSample} />);
    expect(html).toContain("CTL trend");
  });

  it("renders an SVG for line charts", () => {
    const html = renderToString(<ArtifactCard spec={lineSample} />);
    expect(html).toContain("<svg");
    expect(html).toContain("polyline");
  });

  it("renders an SVG with rect for bar charts", () => {
    const html = renderToString(<ArtifactCard spec={barSample} />);
    expect(html).toContain("<svg");
    expect(html).toContain("<rect");
  });

  it("renders a table for table type", () => {
    const html = renderToString(<ArtifactCard spec={tableSample} />);
    expect(html).toContain("<table");
    expect(html).toContain("5k");
    expect(html).toContain("1260");
  });

  it("starts collapsed (h-20 class)", () => {
    const html = renderToString(<ArtifactCard spec={lineSample} />);
    expect(html).toContain("h-20");
    expect(html).not.toContain("h-80");
  });

  it("renders area chart with filled path", () => {
    const areaSpec: ChartSpec = {
      type: "area",
      title: "TSB",
      series: [
        {
          label: "Form",
          style: "area",
          data: [
            { x: 1, y: 10 },
            { x: 2, y: 15 },
            { x: 3, y: 8 },
          ],
        },
      ],
    };
    const html = renderToString(<ArtifactCard spec={areaSpec} />);
    expect(html).toContain("<path");
    expect(html).toContain("<svg");
  });
});
