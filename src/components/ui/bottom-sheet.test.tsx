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
  // Belt-and-braces: the guard test below turns fake timers on and back off
  // itself, but if a future edit throws between the two, real timers must
  // still come back for every test after it.
  vi.useRealTimers();
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
  //
  // NOT racy against close()'s real setTimeout (bottom-sheet.tsx:48), unlike
  // the guard test below: `closing` flips to `true` synchronously inside
  // `close()` itself, before the timeout is even scheduled, so the
  // transform this test reads is never gated on that timer firing. The
  // timeout only delays the *navigation* (`router.push`), which this test
  // never inspects — checked deliberately, per review, not assumed.
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

  // Review finding 1 (slice 2 task 2): StandardWeek (nested in the
  // plan-setup sheet) stages BlockSheet edits in a ref and writes them only
  // from BlockSheet's own onClose. BlockSheet has no Escape handler of its
  // own, so this sheet's document-level keydown listener — which stays live
  // the whole time BlockSheet is open — must not fire close() while a
  // nested `[role="dialog"]` is mounted, or Escape silently discards
  // whatever the nested dialog hadn't saved yet.
  //
  // Fake timers, not a synchronous assert right after dispatch: `close()`
  // only calls `router.push` inside a real `window.setTimeout(fn, delay)`
  // (bottom-sheet.tsx:48; `delay` is 0 here since `matchMedia` above is
  // mocked to report reduced motion). A synchronous assert races that
  // timer's callback against the Node event loop reaching it — caught
  // empirically failing 1 run in 5 against the exact "remove the guard"
  // mutation this test exists to catch (a false pass on the one test
  // guarding a silent-data-loss path). Advancing the fake clock ourselves
  // makes the outcome depend on the guard alone, not on scheduling luck.
  it("does not close on Escape while a nested dialog is mounted", async () => {
    await render(
      <BottomSheet title="Outer" closeHref="/train?tab=week">
        <div role="dialog" aria-modal="true" aria-label="Nested">
          <p>Nested dialog content</p>
        </div>
      </BottomSheet>
    );
    vi.useFakeTimers();
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
      );
    });
    // If the guard failed to stop close(), its setTimeout is now pending on
    // the fake clock — flush it before asserting, so a broken guard cannot
    // hide behind an unfired timer.
    vi.runAllTimers();
    vi.useRealTimers();
    expect(pushMock).not.toHaveBeenCalled();
  });

  // Task 2's own regression, the other half: narrowing the idle-transform
  // condition to `closing ? … : undefined` (dropping the `dragY > 0` half)
  // would leave both tests above green while quietly breaking swipe-follow
  // — the panel would stop tracking a finger mid-drag. A synthetic
  // touchmove is the only thing that catches that.
  it("follows a drag with translateY(dragY) while dragging, not just while closing", async () => {
    const el = await render(
      <BottomSheet title="Outer" closeHref="/train?tab=week">
        <p>Body</p>
      </BottomSheet>
    );
    const dialog = el.querySelector('[role="dialog"]') as HTMLElement;
    await act(async () => {
      const start = new Event("touchstart", { bubbles: true });
      Object.assign(start, { touches: [{ clientY: 100 }] });
      dialog.dispatchEvent(start);
    });
    await act(async () => {
      const move = new Event("touchmove", { bubbles: true });
      Object.assign(move, { touches: [{ clientY: 150 }] });
      dialog.dispatchEvent(move);
    });
    expect(dialog.style.transform).toBe("translateY(50px)");
  });

  // Review finding 3 on task 5's "plan-review" sheet: PlanPreviewCard is
  // ~1.5 phone screens, and this panel is `maxHeight: 92svh; overflowY:
  // auto` -- before this fix, a downward `touchmove` set `dragY`
  // regardless of `scrollTop`, so scrolling back UP through a tall sheet
  // body (the everyday gesture needed to re-read something further up)
  // fought native scroll for the same gesture, and past 110px, dismissed
  // the sheet outright. A drag must not begin while the panel still has
  // room to scroll.
  it("does not begin a drag while the panel is scrolled away from its own top", async () => {
    const el = await render(
      <BottomSheet title="Outer" closeHref="/train?tab=week">
        <p>Body</p>
      </BottomSheet>
    );
    const dialog = el.querySelector('[role="dialog"]') as HTMLElement;
    // jsdom never actually lays out or scrolls content, but `scrollTop`
    // is a plain read/write property regardless -- setting it directly is
    // how the panel's "already scrolled into its content" state is
    // simulated here.
    Object.defineProperty(dialog, "scrollTop", {
      value: 50,
      configurable: true,
    });
    await act(async () => {
      const start = new Event("touchstart", { bubbles: true });
      Object.assign(start, { touches: [{ clientY: 100 }] });
      dialog.dispatchEvent(start);
    });
    await act(async () => {
      const move = new Event("touchmove", { bubbles: true });
      Object.assign(move, { touches: [{ clientY: 150 }] });
      dialog.dispatchEvent(move);
    });
    // No transform at all -- not even a smaller one -- while the panel
    // still has scrolled-past content above it.
    expect(dialog.style.transform).toBe("");
  });

  // The companion case: once the panel genuinely reaches its own top
  // (scrollTop back to 0, whether from more scrolling or having started
  // there), a further downward swipe DOES begin the drag -- the fix must
  // not have disabled swipe-to-dismiss outright, only gated it correctly.
  it("begins the drag once the panel is scrolled back to its own top", async () => {
    const el = await render(
      <BottomSheet title="Outer" closeHref="/train?tab=week">
        <p>Body</p>
      </BottomSheet>
    );
    const dialog = el.querySelector('[role="dialog"]') as HTMLElement;
    let scrollTop = 50;
    Object.defineProperty(dialog, "scrollTop", {
      get: () => scrollTop,
      configurable: true,
    });
    await act(async () => {
      const start = new Event("touchstart", { bubbles: true });
      Object.assign(start, { touches: [{ clientY: 100 }] });
      dialog.dispatchEvent(start);
    });
    await act(async () => {
      // Still scrolled -- ignored, and re-baselines the drag's own start
      // point to this touch (clientY 150), not the original 100.
      const move = new Event("touchmove", { bubbles: true });
      Object.assign(move, { touches: [{ clientY: 150 }] });
      dialog.dispatchEvent(move);
    });
    expect(dialog.style.transform).toBe("");
    scrollTop = 0; // the panel has now reached its own top.
    await act(async () => {
      const move = new Event("touchmove", { bubbles: true });
      Object.assign(move, { touches: [{ clientY: 170 }] });
      dialog.dispatchEvent(move);
    });
    // Measured from the re-baselined 150, not the original 100: a jump to
    // translateY(70px) here would mean the drag silently inherited the
    // whole gesture's distance the instant it was allowed to start.
    expect(dialog.style.transform).toBe("translateY(20px)");
  });
});
