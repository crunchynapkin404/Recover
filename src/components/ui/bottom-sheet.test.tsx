// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

// Same App Router shim week-sheet.test.tsx already needs — BottomSheet
// calls useRouter().push on close.
const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn(), replace: vi.fn() }),
}));

import { BottomSheet } from "./bottom-sheet";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement;

async function render(ui: React.ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(ui);
  });
  return container;
}

beforeEach(() => {
  pushMock.mockClear();
  window.matchMedia = ((query: string) => ({
    matches: true,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

afterEach(async () => {
  if (root) {
    const r = root;
    await act(async () => r.unmount());
    root = null;
  }
  container?.remove();
  document.body.style.overflow = "";
});

describe("BottomSheet", () => {
  // Task 2's own regression, caught before it shipped: a `plan-setup` sheet
  // now hosts StandardWeek, which opens BlockSheet (another `fixed inset-0`
  // dialog) on a day tap. Per the CSS transforms spec, ANY transform value
  // on an ancestor — including `translateY(0px)`, not only a nonzero one —
  // becomes the containing block for a `position: fixed` descendant.
  // Confirmed with a throwaway Playwright repro of this exact markup: with
  // the panel idle at `translateY(0px)`, a nested `fixed inset-0` child
  // collapsed from the full 390x844 viewport to a 390x132 sliver — the size
  // of the OUTER sheet's own panel, not the screen. The panel must carry NO
  // `transform` at all while idle, not merely a zero one, so a sheet opened
  // from inside another sheet still targets the viewport.
  it("carries no transform on the panel while idle, so a nested fixed-position dialog is not trapped", async () => {
    const el = await render(
      <BottomSheet title="Outer" closeHref="/train?tab=week">
        <p>Body</p>
      </BottomSheet>
    );
    const dialog = el.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.style.transform).toBe("");
  });

  // The closing exit animation is the one state that legitimately needs the
  // transform back — proves the idle case above is a real conditional, not
  // a transform that quietly never applied at all.
  it("applies the closing transform once dismissal starts", async () => {
    const el = await render(
      <BottomSheet title="Outer" closeHref="/train?tab=week">
        <p>Body</p>
      </BottomSheet>
    );
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
      );
    });
    const dialog = el.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.style.transform).toBe("translateY(100%)");
  });
});
