// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { CorrelationInsights } from "@/components/journal/correlation-insights";
import type { TagInsight } from "@/lib/insights/correlations";

let container: HTMLDivElement;
let root: Root;

function render(insights: TagInsight[]) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<CorrelationInsights insights={insights} />));
}

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const conclusiveRow: TagInsight = {
  emoji: "🍷",
  behavior: "Alcohol",
  auto: false,
  impactPct: -11,
  ciHalfWidthPct: 6,
  conclusive: true,
  events: 8,
  splits: {
    weekday: {
      impactPct: -13,
      ciHalfWidthPct: 7,
      conclusive: true,
      events: 6,
    },
    weekend: null,
  },
};

const inconclusiveAutoRow: TagInsight = {
  emoji: "🌙",
  behavior: "Late training",
  auto: true,
  impactPct: -2,
  ciHalfWidthPct: 9,
  conclusive: false,
  events: 12,
  splits: { weekday: null, weekend: null },
};

describe("CorrelationInsights v2", () => {
  it("shows impact ± CI for conclusive rows and splits with gating", () => {
    render([conclusiveRow]);
    expect(container.textContent).toContain("-11% ± 6");
    expect(container.textContent).toContain("8 events");
    expect(container.textContent).toContain("-13% ± 7"); // weekday split
    expect(container.textContent).toContain("not enough data"); // weekend
    expect(container.textContent).not.toContain("auto");
  });

  it("greys inconclusive rows and chips auto tags", () => {
    render([inconclusiveAutoRow]);
    expect(container.textContent).toContain("inconclusive");
    expect(container.textContent).not.toContain("-2% ±");
    expect(container.textContent).toContain("auto");
  });

  it("renders nothing without insights", () => {
    render([]);
    expect(container.innerHTML).toBe("");
  });
});
