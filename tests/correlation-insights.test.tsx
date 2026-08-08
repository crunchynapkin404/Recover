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
  evidence: "strong",
  splits: {
    weekday: {
      impactPct: -13,
      ciHalfWidthPct: 7,
      conclusive: true,
      events: 6,
      evidence: "limited",
    },
    weekend: null,
  },
};

const limitedAutoRow: TagInsight = {
  emoji: "🌙",
  behavior: "Late training",
  auto: true,
  impactPct: -2,
  ciHalfWidthPct: 9,
  conclusive: false,
  events: 12,
  evidence: "limited",
  splits: {
    weekday: {
      impactPct: -2,
      ciHalfWidthPct: 9,
      conclusive: false,
      events: 7,
      evidence: "limited",
    },
    weekend: null,
  },
};

// `evidence: "strong"` with `conclusive: false` is the OTHER unconclusive
// state: enough samples, but the interval still straddles zero. It is the
// only branch that renders the word "inconclusive", and v0.64 renamed the
// label around it without ever covering it.
const strongInconclusiveRow: TagInsight = {
  emoji: "🌅",
  behavior: "Early training",
  auto: false,
  impactPct: 1,
  ciHalfWidthPct: 4,
  conclusive: false,
  events: 40,
  evidence: "strong",
  splits: {
    weekday: {
      impactPct: 1,
      ciHalfWidthPct: 4,
      conclusive: false,
      events: 20,
      evidence: "strong",
    },
    weekend: null,
  },
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

  it("greys thin-evidence rows and chips auto tags", () => {
    render([limitedAutoRow]);
    expect(container.textContent).toContain("limited evidence");
    expect(container.textContent).not.toContain("-2% ±");
    expect(container.textContent).toContain("auto");
    // Spaces around the split separator are asserted literally: the label and
    // the event count sit on separate JSX lines, and a bare newline between
    // them is collapsed away rather than rendered as a space.
    expect(container.textContent).toContain("limited evidence · 7 events");
  });

  it("says inconclusive when evidence is strong but the interval straddles zero", () => {
    render([strongInconclusiveRow]);
    expect(container.textContent).toContain("inconclusive");
    expect(container.textContent).not.toContain("limited evidence");
    expect(container.textContent).not.toContain("+1% ±");
    expect(container.textContent).toContain("inconclusive · 20 events");
  });

  it("renders nothing without insights", () => {
    render([]);
    expect(container.innerHTML).toBe("");
  });
});
