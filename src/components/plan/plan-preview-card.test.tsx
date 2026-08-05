// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PlanPreviewCard } from "./plan-preview-card";
import { WARNING_TEXT, type PlanPreview } from "@/lib/plan-preview";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// "use server" is a genuine module boundary, not the logic under test —
// same stubbing convention as races-section-demand.test.tsx.
vi.mock("@/app/plan/actions", () => ({
  confirmPlanAction: vi.fn(),
  regeneratePreviewAction: vi.fn(),
}));

const preview: PlanPreview = {
  planId: "11111111-1111-1111-1111-111111111111",
  sport: "Bike",
  race: {
    id: null,
    name: "Dolomites Gran Fondo",
    date: "2026-09-13",
    priority: "A",
  },
  startDate: "2026-08-05",
  weeksTotal: 6,
  phases: [
    { phase: "base", weeks: 3, weekNumbers: [1, 2, 4] },
    { phase: "build", weeks: 1, weekNumbers: [5] },
    { phase: "taper", weeks: 1, weekNumbers: [6] },
    { phase: "recovery", weeks: 1, weekNumbers: [3] },
  ],
  weeks: Array.from({ length: 6 }, (_, i) => ({
    weekNumber: i + 1,
    phase: "base" as const,
    targetLoad: 400 + i * 10,
    targetHours: 8,
    raceName: i === 5 ? "Dolomites Gran Fondo" : null,
  })),
  startingCtl: { value: 30, source: "default" },
  feasibility: null,
  volume: { source: "fallback", shortfall: null },
  warnings: ["no_ctl_history", "volume_fallback", "race_created"],
};

let root: Root | null = null;
let container: HTMLDivElement;

function mount() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<PlanPreviewCard preview={preview} />);
  });
}

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  container?.remove();
});

describe("PlanPreviewCard", () => {
  it("names the sport and the race", () => {
    mount();
    expect(container.textContent).toContain("Dolomites Gran Fondo");
    expect(container.textContent).toMatch(/Cycling|Bike/);
  });

  // The release's headline requirement: the athlete can check the sum.
  it("shows every phase row and a total equal to weeksTotal", () => {
    mount();
    for (const row of preview.phases) {
      const el = container.querySelector(`[data-testid="phase-${row.phase}"]`);
      expect(el).toBeTruthy();
      expect(el!.textContent).toContain(String(row.weeks));
    }
    expect(
      container.querySelector('[data-testid="phase-total"]')!.textContent
    ).toContain("6");
  });

  it("renders one sentence per warning", () => {
    mount();
    for (const w of preview.warnings) {
      expect(container.textContent).toContain(WARNING_TEXT[w]);
    }
  });

  it("offers the three decisions by name, and nothing to tune periodization with", () => {
    mount();

    const startButton = Array.from(container.querySelectorAll("button")).find(
      (b) => /start this plan/i.test(b.textContent ?? "")
    );
    expect(startButton).toBeTruthy();

    const daysInput = container.querySelector('[aria-label="Days per week"]');
    expect(daysInput).toBeTruthy();

    const hoursInput = container.querySelector('[aria-label="Hours per week"]');
    expect(hoursInput).toBeTruthy();

    // Nothing else is editable — periodization (phase lengths, where
    // recovery weeks land) gets the table above, not a control.
    const periodizationControl = Array.from(
      container.querySelectorAll("input, select, textarea")
    ).find((el) =>
      /progression|recovery/i.test(el.getAttribute("aria-label") ?? "")
    );
    expect(periodizationControl).toBeUndefined();
  });
});
