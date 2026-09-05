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

async function render(
  ui: React.ReactNode,
  parent: HTMLElement = document.body
) {
  container = document.createElement("div");
  parent.appendChild(container);
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

  // I3, final whole-branch review: this shell had no initial focus move,
  // no focus trap and no focus restore, and app-shell.tsx rendered the
  // overlay as the last DOM node with the background neither `inert` nor
  // `aria-hidden`. When this shell hosted only Today's check-in that was
  // a nicety; on the week-destinations branch it became the ONLY route to
  // availability editing, race management and plan setup, and
  // `aria-modal="true"` was inert because focus never actually entered
  // the panel — a keyboard/AT user who activated a summary row had to Tab
  // past every page control plus BottomNav to reach it. Focus IS
  // observable in jsdom even though layout is not
  // (`document.activeElement`); these mutation-check each part.
  describe("focus management", () => {
    it("moves focus into the panel itself when it opens", async () => {
      const trigger = document.createElement("button");
      trigger.textContent = "Open";
      document.body.appendChild(trigger);
      trigger.focus();
      expect(document.activeElement).toBe(trigger);
      const el = await render(
        <BottomSheet title="Outer" closeHref="/train?tab=week">
          <p>Body</p>
        </BottomSheet>
      );
      const dialog = el.querySelector('[role="dialog"]');
      expect(document.activeElement).toBe(dialog);
      trigger.remove();
    });

    it("restores focus to the element that opened it, once the sheet unmounts", async () => {
      const trigger = document.createElement("button");
      trigger.textContent = "Open";
      document.body.appendChild(trigger);
      trigger.focus();
      await render(
        <BottomSheet title="Outer" closeHref="/train?tab=week">
          <p>Body</p>
        </BottomSheet>
      );
      expect(document.activeElement).not.toBe(trigger);
      await act(async () => {
        root!.unmount();
      });
      root = null;
      expect(document.activeElement).toBe(trigger);
      trigger.remove();
    });

    it("moves focus to the panel's first focusable element on a plain Tab from the panel's own initial focus", async () => {
      const el = await render(
        <BottomSheet title="Outer" closeHref="/train?tab=week">
          <button>First</button>
          <button>Last</button>
        </BottomSheet>
      );
      const dialog = el.querySelector('[role="dialog"]');
      expect(document.activeElement).toBe(dialog);
      await act(async () => {
        document.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Tab", bubbles: true })
        );
      });
      expect(document.activeElement).toBe(
        dialog!.querySelectorAll("button")[0]
      );
    });

    it("wraps Tab from the panel's last focusable element back to its first", async () => {
      const el = await render(
        <BottomSheet title="Outer" closeHref="/train?tab=week">
          <button>First</button>
          <button>Last</button>
        </BottomSheet>
      );
      const dialog = el.querySelector('[role="dialog"]');
      const buttons = dialog!.querySelectorAll("button");
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      last.focus();
      expect(document.activeElement).toBe(last);
      await act(async () => {
        document.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Tab", bubbles: true })
        );
      });
      expect(document.activeElement).toBe(first);
    });

    it("wraps Shift+Tab from the panel's first focusable element back to its last", async () => {
      const el = await render(
        <BottomSheet title="Outer" closeHref="/train?tab=week">
          <button>First</button>
          <button>Last</button>
        </BottomSheet>
      );
      const dialog = el.querySelector('[role="dialog"]');
      const buttons = dialog!.querySelectorAll("button");
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      first.focus();
      expect(document.activeElement).toBe(first);
      await act(async () => {
        document.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Tab",
            shiftKey: true,
            bubbles: true,
          })
        );
      });
      expect(document.activeElement).toBe(last);
    });

    // The guard this fix must not regress (see the Escape test above):
    // the Tab trap and the Escape guard are two independent branches of
    // the same handler, and a nested `[role="dialog"]` must leave Tab's
    // own default browser handling alone (no `preventDefault`) exactly
    // as it already leaves Escape alone.
    it("does not trap Tab while a nested dialog is mounted, mirroring the Escape guard", async () => {
      const el = await render(
        <BottomSheet title="Outer" closeHref="/train?tab=week">
          <button>Outer button</button>
          <div role="dialog" aria-modal="true" aria-label="Nested">
            <button>Nested button</button>
          </div>
        </BottomSheet>
      );
      const nestedButton = el.querySelector(
        '[aria-label="Nested"] button'
      ) as HTMLElement;
      nestedButton.focus();
      expect(document.activeElement).toBe(nestedButton);
      let prevented = false;
      await act(async () => {
        const event = new KeyboardEvent("keydown", {
          key: "Tab",
          bubbles: true,
          cancelable: true,
        });
        prevented = !document.dispatchEvent(event);
      });
      // Not redirected by the outer trap — focus is left exactly where
      // the browser's own default Tab handling would take it (untouched
      // by this handler, which is all a jsdom dispatch can prove: no
      // `preventDefault`, no forced `.focus()` call).
      expect(prevented).toBe(false);
      expect(document.activeElement).toBe(nestedButton);
    });
  });
});

/**
 * The background's inert state belongs to the sheet, not to AppShell.
 *
 * Deriving it from AppShell's `overlay` prop shipped two page-killing bugs in
 * two commits: Today passed an always-truthy `<SheetHost/>` whose component
 * renders null (every control on Today inert, on every load), and Coach's
 * overlay is `lg:hidden` — present in the DOM on desktop, rendering nothing —
 * which killed Coach's desktop page and was caught only by the real-browser
 * capture, never by jsdom. A prop cannot know whether a modal is visible; a
 * mounted modal can.
 */
describe("BottomSheet and the background", () => {
  it("marks the background inert while it is mounted", async () => {
    const bg = document.createElement("div");
    bg.setAttribute("data-app-background", "");
    document.body.appendChild(bg);
    try {
      await render(
        <BottomSheet title="Sheet" closeHref="/train?tab=week">
          <button>Inside</button>
        </BottomSheet>
      );
      expect(bg.hasAttribute("inert")).toBe(true);
    } finally {
      bg.remove();
    }
  });

  it("clears it again when it unmounts, so the page comes back", async () => {
    const bg = document.createElement("div");
    bg.setAttribute("data-app-background", "");
    document.body.appendChild(bg);
    try {
      await render(
        <BottomSheet title="Sheet" closeHref="/train?tab=week">
          <button>Inside</button>
        </BottomSheet>
      );
      expect(bg.hasAttribute("inert")).toBe(true);
      const r = root;
      await act(async () => r!.unmount());
      root = null;
      expect(bg.hasAttribute("inert")).toBe(false);
    } finally {
      bg.remove();
    }
  });

  it("does nothing when no background marker exists", async () => {
    await render(
      <BottomSheet title="Sheet" closeHref="/train?tab=week">
        <button>Inside</button>
      </BottomSheet>
    );
    expect(document.querySelector("[inert]")).toBeNull();
  });

  // The third bug of this family, and the first where the sheet suppressed
  // ITSELF. `/activity/[id]` renders the post-ride debrief through AppShell's
  // CHILDREN, not its `overlay` slot, so the panel sits INSIDE
  // `[data-app-background]` — and `inert` applies to the whole subtree, so
  // every control the athlete came to use (RPE 1-10, feel, the note, Save,
  // Skip, even the close scrim) went dead the moment the sheet opened. The
  // page composition is fixed at the call site; this is the guard that makes
  // the mistake unrepeatable, because a modal inerting its own ancestor is
  // never what anyone meant. A background left focusable is a lesser fault
  // than a sheet nobody can touch.
  it("never inerts a background that contains it", async () => {
    const bg = document.createElement("div");
    bg.setAttribute("data-app-background", "");
    document.body.appendChild(bg);
    try {
      const el = await render(
        <BottomSheet title="How was Ride?" closeHref="/activity/x">
          <button>RPE 7</button>
        </BottomSheet>,
        bg
      );
      const dialog = el.querySelector('[role="dialog"]');
      expect(bg.contains(dialog)).toBe(true);
      expect(dialog?.closest("[inert]")).toBeNull();
    } finally {
      bg.remove();
    }
  });
});

/**
 * The hidden-but-mounted case, which killed Coach's desktop page and was
 * caught only by a real-browser capture. Coach wraps its history sheet in
 * `lg:hidden`, so on desktop React mounts this component into a
 * `display: none` subtree. jsdom computes no layout and has no
 * `checkVisibility`, so this test installs one to stand in for the browser.
 */
describe("BottomSheet when it is mounted but not visible", () => {
  it("leaves the background alone", async () => {
    const bg = document.createElement("div");
    bg.setAttribute("data-app-background", "");
    document.body.appendChild(bg);
    const proto = Element.prototype as unknown as {
      checkVisibility?: () => boolean;
    };
    proto.checkVisibility = () => false;
    try {
      await render(
        <BottomSheet title="Hidden" closeHref="/coach">
          <button>Inside</button>
        </BottomSheet>
      );
      expect(bg.hasAttribute("inert")).toBe(false);
    } finally {
      delete proto.checkVisibility;
      bg.remove();
    }
  });

  it("does not steal focus", async () => {
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    trigger.focus();
    const proto = Element.prototype as unknown as {
      checkVisibility?: () => boolean;
    };
    proto.checkVisibility = () => false;
    try {
      await render(
        <BottomSheet title="Hidden" closeHref="/coach">
          <button>Inside</button>
        </BottomSheet>
      );
      expect(document.activeElement).toBe(trigger);
    } finally {
      delete proto.checkVisibility;
      trigger.remove();
    }
  });
});

/**
 * axe's `scrollable-region-focusable`, serious, caught by CI's ratchet on the
 * one sheet whose content is pure prose ("Why this week" has no buttons).
 * The panel is a scroll container; with `tabindex="-1"` a keyboard user could
 * focus nothing inside it and so could not scroll it at all. Sheets that hold
 * controls passed only by accident of having something tabbable.
 */
describe("BottomSheet's panel as a scroll container", () => {
  it("is reachable by keyboard, so a prose-only sheet can be scrolled", async () => {
    const el = await render(
      <BottomSheet title="Why this week" closeHref="/train?tab=week">
        <p>Prose with nothing focusable in it at all.</p>
      </BottomSheet>
    );
    const dialog = el.querySelector('[role="dialog"]');
    expect(dialog?.getAttribute("tabindex")).toBe("0");
  });
});
