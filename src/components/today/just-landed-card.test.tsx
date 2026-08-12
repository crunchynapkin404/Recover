import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { JustLandedCard, downsample } from "./just-landed-card";

const base = {
  activityId: "11111111-2222-3333-4444-555555555555",
  name: "Endurance Spin",
  meta: "Cycling · Tue Aug 11 · intervals.icu",
  asked: "90 min · Zone 2",
  delivered: "1h 32m · 78 load · avg HR 142bpm",
  stats: [
    { label: "Duration", value: "1h 32m" },
    { label: "Distance", value: "38.4", unit: "km" },
    { label: "Load", value: "78" },
  ],
  debrief: null,
  streams: [],
  lapCount: null,
};

describe("downsample", () => {
  it("leaves a short series alone", () => {
    expect(downsample([1, 2, 3], 40)).toEqual([1, 2, 3]);
  });

  it("reduces a long series to the bucket count", () => {
    const long = Array.from({ length: 4000 }, (_, i) => i);
    expect(downsample(long, 40)).toHaveLength(40);
  });

  it("averages within a bucket and keeps the trend's direction", () => {
    const rising = Array.from({ length: 100 }, (_, i) => i);
    const out = downsample(rising, 4) as number[];
    expect(out[0]).toBeLessThan(out[3]);
  });

  it("emits null for a bucket with no real readings", () => {
    const gappy = [...Array(50).fill(null), ...Array(50).fill(5)];
    const out = downsample(gappy, 2);
    expect(out[0]).toBeNull();
    expect(out[1]).toBe(5);
  });
});

describe("JustLandedCard", () => {
  it("names the activity and how it reached us", () => {
    const html = renderToString(<JustLandedCard {...base} />);
    expect(html).toContain("Just landed");
    expect(html).toContain("Endurance Spin");
    expect(html).toContain("intervals.icu");
  });

  it("puts what was asked next to what was delivered", () => {
    const html = renderToString(<JustLandedCard {...base} />);
    expect(html).toContain("Asked");
    expect(html).toContain("90 min · Zone 2");
    expect(html).toContain("Delivered");
    expect(html).toContain("78 load");
  });

  it("shows only what was delivered when the plan asked for nothing", () => {
    const html = renderToString(<JustLandedCard {...base} asked={null} />);
    expect(html).toContain("Delivered");
    expect(html).not.toContain("Asked");
  });

  it("renders each stat with its unit", () => {
    const html = renderToString(<JustLandedCard {...base} />);
    expect(html).toContain("38.4");
    expect(html).toContain("km");
    expect(html).toContain("Distance");
  });

  it("routes into the full activity", () => {
    const html = renderToString(<JustLandedCard {...base} />);
    expect(html).toContain("/activity/11111111-2222-3333-4444-555555555555");
  });

  it("omits the stream strip when nothing is cached", () => {
    const html = renderToString(<JustLandedCard {...base} />);
    expect(html).not.toContain("data-streams");
  });

  it("renders the stream strip when the cache is warm", () => {
    const html = renderToString(
      <JustLandedCard
        {...base}
        streams={[
          { label: "HR", path: "M0 10 L100 4", className: "stroke-chart-5" },
        ]}
      />
    );
    expect(html).toContain("data-streams");
    expect(html).toContain("stroke-chart-5");
    expect(html).toContain("HR");
  });

  it("counts laps only when there are some", () => {
    // React 19 inserts a <!-- --> comment marker between the adjacent
    // {lapCount} expression and the " laps recorded" text child, so the
    // rendered HTML reads "6<!-- --> laps recorded" rather than "6 laps
    // recorded" verbatim.
    expect(renderToString(<JustLandedCard {...base} lapCount={6} />)).toContain(
      "6<!-- --> laps recorded"
    );
    expect(
      renderToString(<JustLandedCard {...base} lapCount={0} />)
    ).not.toContain("laps recorded");
    expect(renderToString(<JustLandedCard {...base} />)).not.toContain(
      "laps recorded"
    );
  });

  it("folds in the debrief answer, note and coach review", () => {
    const html = renderToString(
      <JustLandedCard
        {...base}
        debrief={{
          answer: "RPE 6 · felt normal",
          notes: "Legs heavy on the first climb, opened up after.",
          review: "Solid aerobic session — 78 load lines up with the ask.",
        }}
      />
    );
    expect(html).toContain("RPE 6 · felt normal");
    expect(html).toContain("Legs heavy on the first climb");
    expect(html).toContain("Solid aerobic session");
  });

  it("omits the debrief box entirely when there is no debrief", () => {
    const html = renderToString(<JustLandedCard {...base} />);
    expect(html).not.toContain("Debrief");
  });

  it("uses the token type and ink scales", () => {
    const html = renderToString(<JustLandedCard {...base} />);
    expect(html).toContain("text-label");
    expect(html).toMatch(/text-ink-(primary|secondary|muted)/);
    expect(html).not.toMatch(/text-white\//);
    expect(html).not.toMatch(/text-\[[\d.]+px\]/);
  });
});
