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

  it("excludes a week with an unknown target from season adherence, not just from its own target sum", () => {
    // Old bug: a null target contributed 0 to the target sum but its real
    // actualLoad still landed in the actual sum unconditionally, inflating
    // the ratio. Week A (no known target, 100 actual) must not count at
    // all; only week B (target 200, actual 150) should: 150/200 = 75%, not
    // (100+150)/(0+200) = 125%.
    const html = renderToString(
      <SeasonTimelineCard
        data={[
          {
            weekStart: "2026-06-29",
            targetLoad: null,
            actualLoad: 100,
            sessions: 2,
          },
          {
            weekStart: "2026-07-06",
            targetLoad: 200,
            actualLoad: 150,
            sessions: 3,
          },
        ]}
      />
    );
    expect(html).toContain("75%");
    expect(html).not.toContain("125%");
  });

  it("shows season adherence as unknown, not zero, when every week's target is unknown", () => {
    const html = renderToString(
      <SeasonTimelineCard
        data={[
          {
            weekStart: "2026-07-06",
            targetLoad: null,
            actualLoad: 80,
            sessions: 1,
          },
        ]}
      />
    );
    expect(html).toContain("Season adherence");
    // The stat block renders "—" for both the unknown target and the
    // (now equally unknown) adherence percentage.
    expect(html).not.toMatch(/Season adherence[\s\S]{0,80}\d+%/);
  });
});
