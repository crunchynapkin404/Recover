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
import { IntakeForm, type IntakeState } from "./intake-form";

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

  // Task 4's own composition: IntakeForm — now nested in the "availability"
  // sheet — opens BlockSheet (another `fixed inset-0` `role="dialog"`) on a
  // day tap, exactly the shape ded5f64/fe7b77b fixed for StandardWeek's own
  // nested BlockSheet inside the "plan-setup" sheet. Both fixes (BottomSheet
  // carries no `transform` while idle; BottomSheet skips its own Escape
  // close while a nested dialog is mounted) live at the BottomSheet shell,
  // so they should already cover this caller too — but "correct for one
  // caller, broken for the other" is exactly this branch's failure pattern,
  // per the task brief, so this is exercised directly with the REAL
  // IntakeForm/BlockSheet tree rather than trusted from the generic
  // bare-`role="dialog"` stand-in bottom-sheet.test.tsx already covers.
  it("does not close on Escape, or lose the staged edit, while IntakeForm's own BlockSheet is open", async () => {
    const resolved = Array.from({ length: 7 }, () => []);
    const action = vi.fn(async (): Promise<IntakeState> => ({ message: "" }));
    const el = await render(
      <WeekSheet title="Availability" closeHref="/train?tab=week">
        <IntakeForm
          resolved={resolved}
          dates={[]}
          overrideDates={[]}
          verdict={{ kind: "ok" }}
          sports={["Bike"]}
          action={action}
        />
      </WeekSheet>
    );

    // Open Monday's block editor — a real day tap through the real
    // IntakeForm, not a stand-in.
    const monBtn = Array.from(el.querySelectorAll("button")).find(
      (b) =>
        // Slice 3: the day list became AvailabilityTimeline, so a day is
        // opened from its own "edit precisely" control rather than by
        // tapping a row. Same behaviour under test, new affordance.
        b.getAttribute("aria-label") === "Edit Monday precisely"
    );
    if (!monBtn) throw new Error("no Monday row in the day list");
    await act(async () => {
      monBtn.click();
    });
    const nested = el.querySelector(
      '[role="dialog"][aria-label="Availability for Monday"]'
    );
    expect(nested).not.toBeNull();

    // The outer sheet's own panel must carry no `transform` while idle,
    // even with BlockSheet nested inside it — the exact regression that
    // collapsed a nested `fixed inset-0` dialog to the outer panel's own
    // 132px sliver (ded5f64).
    const outerDialog = el.querySelector(
      '[role="dialog"][aria-label="Availability"]'
    ) as HTMLElement;
    expect(outerDialog.style.transform).toBe("");

    // Escape must not reach the outer sheet's close() while BlockSheet is
    // open — see bottom-sheet.test.tsx's own comment for why this needs
    // fake timers rather than a synchronous assert: close()'s
    // `router.push` runs inside a real `window.setTimeout`, and a bare
    // assert right after dispatch races that timer against the event loop
    // (caught empirically failing 1 run in 5 against the mutation this
    // guards).
    vi.useFakeTimers();
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
      );
    });
    vi.runAllTimers();
    vi.useRealTimers();

    expect(pushMock).not.toHaveBeenCalled();
    // The nested dialog is still mounted — Escape did not unmount its host
    // and silently discard whatever it hadn't saved yet.
    expect(
      el.querySelector('[role="dialog"][aria-label="Availability for Monday"]')
    ).not.toBeNull();
  });
});
