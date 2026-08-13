// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import type { SeasonTimelinePoint } from "@/lib/charts";
import { SeasonTimelineCard } from "./season-timeline-card";

/**
 * The component's own `weekLabel` is module-private, so this mirrors it
 * rather than importing it. Deliberately a mirror and not a hardcoded
 * "Mar 22": if the fixture's last week moves, the expectation moves with
 * it, and if the component's date formatting changes this diverges and the
 * test says so — which is the whole point of asserting on the last tick.
 */
function expectedWeekLabel(weekStart: string): string {
  const d = new Date(`${weekStart}T00:00:00`);
  return `${d.toLocaleDateString("en-US", { month: "short" })} ${d.getDate()}`;
}

// Mirrors docs/design/v0.99-train.html#season's fixture figures exactly
// (Wk 1 480/460/5 through Wk 12 580/412/5) so the test fixture and the
// design reference describe the same twelve weeks. weekStart values are
// twelve consecutive real Mondays.
const TWELVE_WEEKS: SeasonTimelinePoint[] = [
  { weekStart: "2026-01-04", targetLoad: 480, actualLoad: 460, sessions: 5 },
  { weekStart: "2026-01-11", targetLoad: 520, actualLoad: 510, sessions: 6 },
  { weekStart: "2026-01-18", targetLoad: 560, actualLoad: 340, sessions: 4 },
  { weekStart: "2026-01-25", targetLoad: 380, actualLoad: 400, sessions: 4 },
  { weekStart: "2026-02-01", targetLoad: 600, actualLoad: 590, sessions: 6 },
  { weekStart: "2026-02-08", targetLoad: 610, actualLoad: 480, sessions: 5 },
  { weekStart: "2026-02-15", targetLoad: 560, actualLoad: 560, sessions: 6 },
  { weekStart: "2026-02-22", targetLoad: 380, actualLoad: 350, sessions: 3 },
  { weekStart: "2026-03-01", targetLoad: 650, actualLoad: 600, sessions: 6 },
  { weekStart: "2026-03-08", targetLoad: 600, actualLoad: 0, sessions: 0 },
  { weekStart: "2026-03-15", targetLoad: 620, actualLoad: 410, sessions: 4 },
  { weekStart: "2026-03-22", targetLoad: 580, actualLoad: 412, sessions: 5 },
];

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

describe("SeasonTimelineCard — restructured for the floor (v0.99 slice 2)", () => {
  it("labels every third week on the axis, not every bar", () => {
    const html = renderToString(<SeasonTimelineCard data={TWELVE_WEEKS} />);
    // 12 bars, 4 ticks: weeks 1, 4, 7, 10 — plus the last week, which is
    // always labelled because the detail line names it.
    const ticks = html.match(/data-axis-tick/g) ?? [];
    expect(ticks).toHaveLength(5);

    // Pin the LAST week specifically. The count alone does not: dropping
    // `|| i === data.length - 1` leaves ticks at 0/3/6/9 — still four, still
    // inside any range bound, and the one label the detail readout names
    // would be the one silently missing.
    const lastLabel = expectedWeekLabel(
      TWELVE_WEEKS[TWELVE_WEEKS.length - 1].weekStart
    );
    expect(html).toMatch(new RegExp(`data-axis-tick[^>]*>${lastLabel}<`));
  });

  it("carries no per-bar session-count label", () => {
    const html = renderToString(<SeasonTimelineCard data={TWELVE_WEEKS} />);
    // The 8px "5s" / "no" labels under each column are gone.
    expect(html).not.toMatch(/>\d+s</);
    expect(html).not.toMatch(/>no</);
  });

  it("replaces them with one legible readout for the latest week", () => {
    const html = renderToString(<SeasonTimelineCard data={TWELVE_WEEKS} />);
    const latest = TWELVE_WEEKS[TWELVE_WEEKS.length - 1];
    expect(html).toContain(String(latest.actualLoad));
    expect(html).toContain(String(latest.targetLoad));
    expect(html).toMatch(/sessions?/);
  });

  it("keeps every week reachable on hover rather than dropping the data", () => {
    const html = renderToString(<SeasonTimelineCard data={TWELVE_WEEKS} />);
    // One title per bar pair, still — the restructure removes labels, not data.
    expect((html.match(/title="/g) ?? []).length).toBeGreaterThanOrEqual(12);
  });

  it("scrolls rather than compressing bars below a legible width", () => {
    const html = renderToString(<SeasonTimelineCard data={TWELVE_WEEKS} />);
    expect(html).toMatch(/overflow-x-auto/);
    expect(html).toMatch(/min-w-max/);
  });

  it("uses the token scale, not ad-hoc sizes or white alphas", () => {
    const html = renderToString(<SeasonTimelineCard data={TWELVE_WEEKS} />);
    expect(html).not.toMatch(/text-\[[\d.]+px\]/);
    expect(html).not.toMatch(/text-white\//);
    expect(html).not.toMatch(/bg-white\//);
    expect(html).not.toMatch(/border-white\//);
  });
});
