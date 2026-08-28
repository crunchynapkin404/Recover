// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

// BottomSheet (the shell WeekSheet wraps) calls useRouter() on close — same
// shim first-run.test.tsx and day-param-self-heals.test.tsx already use for
// App Router hooks jsdom has no context for.
const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn(), replace: vi.fn() }),
}));

import { WeekSheet } from "./week-sheet";

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
  // jsdom does not implement matchMedia at all — BottomSheet reads
  // prefers-reduced-motion in a mount effect, which would otherwise throw
  // "window.matchMedia is not a function" the moment this wrapper renders
  // it. Reporting reduced motion also makes close() skip its 220ms exit
  // delay, so the Escape test below needs no fake timers.
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

describe("WeekSheet", () => {
  it("renders the title as the dialog's accessible name", async () => {
    const el = await render(
      <WeekSheet title="Why this week" closeHref="/train?tab=week">
        <p>Body content</p>
      </WeekSheet>
    );
    const dialog = el.querySelector('[role="dialog"]');
    expect(dialog?.getAttribute("aria-label")).toBe("Why this week");
    expect(dialog?.getAttribute("aria-modal")).toBe("true");
  });

  it("renders its children inside the dialog", async () => {
    const el = await render(
      <WeekSheet title="Why this week" closeHref="/train?tab=week">
        <p data-testid="probe">Body content</p>
      </WeekSheet>
    );
    expect(el.querySelector('[data-testid="probe"]')?.textContent).toBe(
      "Body content"
    );
  });

  // WeekSheet is meant to add "almost nothing" over BottomSheet — the one
  // behaviour worth exercising here is that closeHref actually reaches it,
  // since a typo'd prop name would silently leave the sheet un-closeable.
  it("closes on Escape by navigating to closeHref", async () => {
    await render(
      <WeekSheet title="Why this week" closeHref="/train?tab=week">
        <p>Body content</p>
      </WeekSheet>
    );

    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
      );
      // Flushes BottomSheet's close() setTimeout (0ms here, since the
      // reduced-motion stub above skips the 220ms exit transition).
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(pushMock).toHaveBeenCalledWith("/train?tab=week");
  });
});
