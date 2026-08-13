import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import {
  HistoryList,
  clockDuration,
  compactKm,
  type HistoryRow,
} from "./history-list";

const row = (over: Partial<HistoryRow> = {}): HistoryRow => ({
  id: "a1",
  name: "Morning Intervals",
  sport: "Ride",
  startDate: new Date("2026-07-22T07:30:00Z"),
  durationS: 4500,
  load: 78,
  distanceM: 32_000,
  feedback: null,
  ...over,
});

describe("clockDuration", () => {
  it("formats as h:mm", () => {
    expect(clockDuration(4500)).toBe("1:15");
    expect(clockDuration(2520)).toBe("0:42");
  });

  it("returns null rather than a zero for missing duration", () => {
    expect(clockDuration(null)).toBeNull();
  });
});

describe("compactKm", () => {
  it("drops the decimal above 10 km and keeps it below", () => {
    expect(compactKm(32_000)).toBe("32km");
    expect(compactKm(8_200)).toBe("8.2km");
  });

  it("returns null for a distance-less activity", () => {
    expect(compactKm(null)).toBeNull();
  });
});

const GROUPS = [{ day: "2026-07-22", items: [row()] }];

describe("HistoryList", () => {
  it("sizes the row to its content instead of clipping at a fixed height", () => {
    const html = renderToString(<HistoryList groups={GROUPS} />);
    expect(html).not.toMatch(/\bh-14\b/);
    expect(html).toMatch(/min-h-16/);
  });

  it("keeps truncation on both lines — the existing, correct behaviour", () => {
    const html = renderToString(<HistoryList groups={GROUPS} />);
    expect(html.match(/truncate/g)!.length).toBeGreaterThanOrEqual(2);
  });

  it("uses the token scale, not ad-hoc sizes or white alphas", () => {
    const html = renderToString(<HistoryList groups={GROUPS} />);
    expect(html).not.toMatch(/text-\[[\d.]+px\]/);
    expect(html).not.toMatch(/text-white\//);
    expect(html).not.toMatch(/bg-white\//);
    expect(html).not.toMatch(/border-white\//);
  });

  it("paints the sport rail from tokens, not rgba literals", () => {
    const html = renderToString(<HistoryList groups={GROUPS} />);
    expect(html).not.toMatch(/rgba\(/);
    expect(html).toMatch(/var\(--chart-/);
  });

  it("puts name, sport and the metric trio on one row", () => {
    const html = renderToString(
      <HistoryList groups={[{ day: "2026-07-22", items: [row()] }]} />
    );
    expect(html).toContain("Morning Intervals");
    expect(html).toContain("Ride");
    expect(html).toContain("1:15");
    expect(html).toContain("78");
    expect(html).toContain("32km");
  });

  it("links each row to its activity detail", () => {
    const html = renderToString(
      <HistoryList
        groups={[{ day: "2026-07-22", items: [row({ id: "xyz" })] }]}
      />
    );
    expect(html).toContain('href="/activity/xyz"');
  });

  it("shows the athlete's own feedback in the sub-line when there is any", () => {
    const html = renderToString(
      <HistoryList
        groups={[
          {
            day: "2026-07-22",
            items: [row({ feedback: "RPE 7 · felt strong" })],
          },
        ]}
      />
    );
    expect(html).toContain("RPE 7 · felt strong");
  });

  it("omits metrics that are missing instead of printing zeroes", () => {
    const html = renderToString(
      <HistoryList
        groups={[
          {
            day: "2026-07-22",
            items: [row({ load: null, distanceM: null })],
          },
        ]}
      />
    );
    expect(html).toContain("1:15");
    expect(html).not.toContain("0km");
    expect(html).not.toContain("· 0 ·");
  });
});
