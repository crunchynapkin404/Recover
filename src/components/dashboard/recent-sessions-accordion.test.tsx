// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { RecentSessionsAccordion } from "./recent-sessions-accordion";

const weeklySummary = {
  workouts: 4,
  totalVolume: "5.2h",
  avgLoad: "62",
  streak: 3,
  ringOuter: 0.8,
  ringInner: 0.6,
};

const milestones = {
  currentStreak: 3,
  bestStreak: 10,
  planWeeksCompleted: 2,
  plansCompleted: 0,
};

const activity = {
  id: "a1",
  name: "Morning Ride",
  sport: "Ride",
  startDate: new Date("2026-07-19T08:00:00Z"),
  durationS: 3600,
  distanceM: 20000,
  load: 55,
};

/** Mounts, clicks the trigger open, and returns the live container. */
function renderOpen(node: React.ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root;
  act(() => {
    root = createRoot(container);
    root.render(node);
  });
  const trigger = container.querySelector("button");
  if (!trigger) throw new Error("trigger button not found");
  act(() => {
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  return container;
}

describe("RecentSessionsAccordion", () => {
  it("defaults to closed and shows a sessions-count badge", () => {
    const html = renderToString(
      <RecentSessionsAccordion
        weeklySummary={weeklySummary}
        milestones={milestones}
        recentActivities={[activity]}
      />
    );
    expect(html).not.toContain("data-panel-open");
    // React splits the badge's number and " sessions" text across adjacent
    // nodes (with an HTML comment between them for hydration), so match loosely.
    expect(html).toMatch(/>1<!-- -->\s*sessions/);
    expect(html).toContain("Recent Sessions");
  });

  it("always renders the weekly summary and milestones cards", () => {
    const container = renderOpen(
      <RecentSessionsAccordion
        weeklySummary={weeklySummary}
        milestones={milestones}
        recentActivities={[]}
      />
    );
    expect(container.innerHTML).toContain("This Week");
    expect(container.innerHTML).toContain("Milestones");
  });

  it("shows the empty state when there are no synced activities", () => {
    const container = renderOpen(
      <RecentSessionsAccordion
        weeklySummary={weeklySummary}
        milestones={milestones}
        recentActivities={[]}
      />
    );
    expect(container.innerHTML).toContain("No activities synced yet.");
    expect(container.innerHTML).toContain("0 sessions");
  });

  it("lists activities with duration and distance when present", () => {
    const container = renderOpen(
      <RecentSessionsAccordion
        weeklySummary={weeklySummary}
        milestones={milestones}
        recentActivities={[activity]}
      />
    );
    expect(container.innerHTML).toContain("Morning Ride");
    expect(container.innerHTML).not.toContain("No activities synced yet.");
  });

  it("shows only the first five activities, but badges the true total", () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      ...activity,
      id: `a${i}`,
      name: `Ride ${i}`,
    }));
    const container = renderOpen(
      <RecentSessionsAccordion
        weeklySummary={weeklySummary}
        milestones={milestones}
        recentActivities={many}
      />
    );
    for (let i = 0; i < 5; i++)
      expect(container.innerHTML).toContain(`Ride ${i}`);
    for (let i = 5; i < 8; i++)
      expect(container.innerHTML).not.toContain(`Ride ${i}`);
    expect(container.innerHTML).toContain("8 sessions");
  });
});
