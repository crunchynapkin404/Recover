import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { MilestonesCard } from "./milestones-card";

const base = {
  currentStreak: 6,
  bestStreak: 11,
  planWeeksCompleted: 3,
  plansCompleted: 1,
};

describe("MilestonesCard", () => {
  it("holds the floor and uses no ad-hoc ink", () => {
    const html = renderToString(<MilestonesCard {...base} />);
    expect(html).not.toMatch(/text-\[\d/);
    expect(html).not.toContain("text-white/");
  });

  it("keeps the label above its detail in the ink hierarchy", () => {
    const html = renderToString(<MilestonesCard {...base} />);
    // The row label reads louder than the "best 11" that qualifies it.
    expect(html).toContain("text-ink-secondary");
    expect(html).toContain("text-ink-muted");
  });

  it("still drops the streak row when the page already shows it", () => {
    const html = renderToString(<MilestonesCard {...base} hideStreak />);
    expect(html).not.toContain("Logging streak");
    expect(html).toContain("Plans completed");
  });
});
