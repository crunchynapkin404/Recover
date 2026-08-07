// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { SeasonTimelineCard } from "./season-timeline-card";

describe("SeasonTimelineCard", () => {
  it("renders a chart region with accessible label", () => {
    const html = renderToString(
      <SeasonTimelineCard
        data={[
          {
            weekStart: "2026-07-06",
            targetLoad: 420,
            actualLoad: 390,
            sessions: 4,
          },
        ]}
      />
    );

    expect(html).toContain("Season progress");
    expect(html).toContain(
      'aria-label="Season timeline chart showing weekly target and actual load"'
    );
    expect(html).toContain("Latest target");
    expect(html).toContain("Latest actual");
  });

  it("shows explicit empty state text when no points exist", () => {
    const html = renderToString(<SeasonTimelineCard data={[]} />);
    expect(html).toContain("No week timeline yet");
  });

  it("keeps unknown target as unknown text", () => {
    const html = renderToString(
      <SeasonTimelineCard
        data={[
          {
            weekStart: "2026-07-06",
            targetLoad: null,
            actualLoad: 120,
            sessions: 1,
          },
        ]}
      />
    );
    expect(html).toContain("Target stays unknown");
  });

  it("labels an upcoming latest week explicitly", () => {
    const html = renderToString(
      <SeasonTimelineCard
        data={[
          {
            weekStart: "2099-01-04",
            targetLoad: 300,
            actualLoad: 0,
            sessions: 0,
          },
        ]}
      />
    );
    expect(html).toContain("Latest week is upcoming");
  });
});
