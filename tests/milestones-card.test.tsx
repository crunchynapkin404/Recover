// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { MilestonesCard } from "@/components/dashboard/milestones-card";
import type { Milestones } from "@/lib/insights/milestones";

let container: HTMLDivElement;
let root: Root;

function render(m: Milestones, props?: { hideStreak?: boolean }) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<MilestonesCard {...m} {...props} />));
}

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("MilestonesCard", () => {
  it("shows real values with best-streak detail", () => {
    render({
      currentStreak: 12,
      bestStreak: 21,
      planWeeksCompleted: 4,
      plansCompleted: 1,
    });
    expect(container.textContent).toContain("12 days");
    expect(container.textContent).toContain("best 21");
    expect(container.textContent).toContain("4");
    expect(container.textContent).toContain("1");
  });

  it("renders muted em-dashes for zeros — never a celebration prompt", () => {
    render({
      currentStreak: 0,
      bestStreak: 0,
      planWeeksCompleted: 0,
      plansCompleted: 0,
    });
    expect(container.textContent).toContain("—");
    expect(container.textContent).not.toContain("best");
    expect(container.textContent).not.toContain("0 days");
  });

  it("singular day", () => {
    render({
      currentStreak: 1,
      bestStreak: 5,
      planWeeksCompleted: 0,
      plansCompleted: 0,
    });
    expect(container.textContent).toContain("1 day");
    expect(container.textContent).not.toContain("1 days");
  });

  it("hides the logging-streak row when hideStreak is set (already shown elsewhere)", () => {
    render(
      {
        currentStreak: 12,
        bestStreak: 21,
        planWeeksCompleted: 4,
        plansCompleted: 1,
      },
      { hideStreak: true }
    );
    expect(container.textContent).not.toContain("Logging streak");
    expect(container.textContent).not.toContain("12 days");
    expect(container.textContent).not.toContain("best 21");
    // The other milestones remain.
    expect(container.textContent).toContain("Plan weeks completed");
    expect(container.textContent).toContain("4");
  });

  it("keeps a durable best-ever streak visible when the current streak lapses", () => {
    render({
      currentStreak: 0,
      bestStreak: 21,
      planWeeksCompleted: 0,
      plansCompleted: 0,
    });
    expect(container.textContent).toContain("—");
    expect(container.textContent).toContain("best 21");
    expect(container.textContent).not.toContain("0 days");
  });
});
