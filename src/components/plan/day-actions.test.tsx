// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { DayActions, friendlyPlanError } from "./day-actions";

vi.mock("@/app/plan/actions", () => ({
  previewPlanChange: vi.fn(),
  applyPlanChange: vi.fn(),
}));

import { applyPlanChange, previewPlanChange } from "@/app/plan/actions";

const previewMock = vi.mocked(previewPlanChange);
const applyMock = vi.mocked(applyPlanChange);

describe("DayActions", () => {
  it("renders nothing for a day without a workout", () => {
    expect(
      renderToString(
        <DayActions
          day={{ date: "2026-08-25", hasWorkout: false }}
          otherDays={[]}
        />
      )
    ).toBe("");
  });

  it("offers move/swap/skip for a workout day", () => {
    const html = renderToString(
      <DayActions
        day={{ date: "2026-08-25", hasWorkout: true }}
        otherDays={[
          { date: "2026-08-26", hasWorkout: false, isRace: false },
          { date: "2026-08-30", hasWorkout: false, isRace: true },
        ]}
      />
    );
    expect(html.toLowerCase()).toContain("move");
    // race days are never offered as targets
    expect(html).not.toContain("2026-08-30");
  });

  it("includes the non-race target date as a move option", () => {
    const html = renderToString(
      <DayActions
        day={{ date: "2026-08-25", hasWorkout: true }}
        otherDays={[
          { date: "2026-08-26", hasWorkout: false, isRace: false },
          { date: "2026-08-30", hasWorkout: false, isRace: true },
        ]}
      />
    );
    expect(html).toContain("2026-08-26");
  });
});

describe("friendlyPlanError", () => {
  it("translates known service/action codes into human copy", () => {
    expect(friendlyPlanError("invalid")).toMatch(/isn.t allowed/i);
    expect(friendlyPlanError("no_open_week")).toBe(
      "No open week to change right now."
    );
  });

  it("falls back to generic copy for unknown or missing codes", () => {
    expect(friendlyPlanError("missing_target")).toBe(
      "Could not apply the change."
    );
    expect(friendlyPlanError(undefined)).toBe("Could not apply the change.");
    expect(friendlyPlanError(null)).toBe("Could not apply the change.");
  });

  it("never returns a raw code verbatim", () => {
    for (const code of ["invalid", "no_open_week", "missing_target"]) {
      expect(friendlyPlanError(code)).not.toBe(code);
    }
  });
});

describe("DayActions error rendering (interaction)", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  function renderComponent() {
    act(() => {
      root = createRoot(container);
      root.render(
        <DayActions
          day={{ date: "2026-08-25", hasWorkout: true }}
          otherDays={[{ date: "2026-08-26", hasWorkout: false, isRace: false }]}
        />
      );
    });
  }

  function click(el: Element | null) {
    if (!el) throw new Error("element not found");
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }

  function findButtonByText(text: string): HTMLButtonElement {
    const btn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === text
    );
    if (!btn) throw new Error(`button "${text}" not found`);
    return btn;
  }

  it("shows friendly copy, not the raw code, when preview fails", async () => {
    previewMock.mockResolvedValue({ ok: false, error: "no_open_week" });
    renderComponent();

    // "skip" needs no target day, so we can go straight to Preview.
    const actionSelect = container.querySelector(
      'select[aria-label="Plan change"]'
    ) as HTMLSelectElement;
    await act(async () => {
      actionSelect.value = "skip";
      actionSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });

    await act(async () => {
      click(findButtonByText("Preview"));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).not.toContain("no_open_week");
    expect(container.textContent).toContain(
      "No open week to change right now."
    );
  });

  it("shows friendly copy, not the raw code, when apply fails", async () => {
    previewMock.mockResolvedValue({
      ok: true,
      insufficient: false,
      anchorDate: "2026-08-30",
      anchorRace: null,
      beforeTsb: 5,
      afterTsb: 3,
      beforeBand: "grey",
      afterBand: "grey",
      loadDelta: 0,
    });
    applyMock.mockResolvedValue({ ok: false, error: "invalid" });
    renderComponent();

    const targetSelect = container.querySelector(
      'select[aria-label="Target day"]'
    ) as HTMLSelectElement;
    await act(async () => {
      targetSelect.value = "2026-08-26";
      targetSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });

    await act(async () => {
      click(findButtonByText("Preview"));
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      click(findButtonByText("Confirm"));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).not.toContain("invalid");
    expect(container.textContent).toContain("That move isn't allowed");
  });
});
