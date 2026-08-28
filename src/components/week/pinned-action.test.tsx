// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PinnedAction } from "./pinned-action";

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

afterEach(async () => {
  if (root) {
    const r = root;
    await act(async () => r.unmount());
    root = null;
  }
  container?.remove();
});

const noop = async () => {};

describe("PinnedAction", () => {
  it("keeps the action reachable and out of the bottom nav's way", async () => {
    const el = await render(
      <PinnedAction label="Confirm week" formAction={noop} />
    );
    const wrap = el.querySelector("[data-pinned-action]");
    expect(wrap?.className).toContain("sticky");
    // Measured at 390x844 against the real BottomNav (Task 6 report):
    // fixed, bottom-8 (32px), 72px tall — its top edge sits 104px above
    // the viewport's bottom edge. bottom-20 (80px, the brief's unverified
    // guess) undershoots that by 24px and would sit UNDER BottomNav.
    // bottom-32 (128px) clears it with 24px to spare, and matches
    // AppShell's own `pb-32` bottom safe-clearance convention.
    expect(wrap?.className).toContain("bottom-32");
  });

  // M2, final whole-branch review: `bottom-32` had no `lg:` variant, but
  // BottomNav is `lg:hidden` and AppShell itself drops to `lg:pb-0` — on
  // desktop there is nothing at the bottom of the viewport to clear, so
  // the unconditional 128px left this band floating with 128px of empty
  // space beneath it. `lg:bottom-6` matches the same mobile-vs-desktop
  // split chat-interface.tsx already uses for its own bottom-docked bar
  // (`pb-[…+96px] lg:pb-6`) rather than inventing a new number.
  it("drops to a small desktop clearance once BottomNav is gone", async () => {
    const el = await render(
      <PinnedAction label="Confirm week" formAction={noop} />
    );
    const wrap = el.querySelector("[data-pinned-action]");
    expect(wrap?.className).toContain("lg:bottom-6");
  });

  it("carries a translucent blurred band so content scrolling under it stays legible", async () => {
    const el = await render(
      <PinnedAction label="Confirm week" formAction={noop} />
    );
    const wrap = el.querySelector("[data-pinned-action]");
    expect(wrap?.className).toContain("bg-surface-base/95");
    expect(wrap?.className).toContain("backdrop-blur");
  });

  it("is a real submit button, not a link that posts", async () => {
    const el = await render(
      <PinnedAction label="Confirm week" formAction={noop} />
    );
    const btn = el.querySelector('button[type="submit"]');
    expect(btn?.textContent).toBe("Confirm week");
    expect(el.querySelector("a")).toBeNull();
  });

  it("submits the enclosing form's real fields through the given action, not just paints a label", async () => {
    // PinnedAction renders no <form> of its own — it must reuse whichever
    // form its caller already owns (IntakeForm's per-day hidden inputs,
    // startWeek's empty one), or the athlete's edits would never reach the
    // server action. A bare label + onClick stub would pass a shallower
    // version of this test without proving that.
    const action = vi.fn(async (_fd: FormData) => {});
    const el = await render(
      <form>
        <input type="hidden" name="probe" value="real-value" />
        <PinnedAction label="Confirm week" formAction={action} />
      </form>
    );
    const btn = el.querySelector('button[type="submit"]') as HTMLButtonElement;
    await act(async () => {
      btn.click();
    });
    expect(action).toHaveBeenCalledTimes(1);
    const fd = action.mock.calls[0]?.[0] as FormData;
    expect(fd.get("probe")).toBe("real-value");
  });

  it("disables the button while its submission is pending, so a slow request can't be double-fired", async () => {
    const el = await render(
      <PinnedAction label="Confirm week" formAction={noop} pending />
    );
    const btn = el.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  // Review finding 1 (task 4 fix pass): the spec's own pinned-label list
  // includes "Set next week's availability" beside "Confirm week"/"Plan
  // this week" — pure navigation, not a submit. `href` is the opt-in for
  // that shape; the default (no `href`) stays exactly the submit button
  // the test above already pins, so this is a genuinely separate code path
  // rather than a widened one.
  it("renders a real navigation link when given href, not a disguised button", async () => {
    const el = await render(
      <PinnedAction
        label="Set next week's availability"
        href="/train?sheet=availability"
      />
    );
    const link = el.querySelector("a");
    expect(link?.getAttribute("href")).toBe("/train?sheet=availability");
    expect(link?.textContent).toBe("Set next week's availability");
    expect(el.querySelector("button")).toBeNull();
  });

  // Review finding 4 (task 4 fix pass): `IntakeForm` — now nested inside
  // the "availability" sheet — is the first caller whose nearest scrolling
  // ancestor is the sheet's own panel, not the page. `variant="sheet"`
  // must drop the BottomNav-measured `bottom-32`/`lg:bottom-6` entirely,
  // not merely add to it — BottomNav sits behind the sheet's own scrim,
  // so there is nothing there to clear.
  it("drops the page's BottomNav clearance for variant=\"sheet\", using the panel's own edge instead", async () => {
    const el = await render(
      <PinnedAction label="Confirm week" formAction={noop} variant="sheet" />
    );
    const wrap = el.querySelector("[data-pinned-action]");
    expect(wrap?.className).toContain("bottom-0");
    expect(wrap?.className).not.toContain("bottom-32");
    expect(wrap?.className).not.toContain("lg:bottom-6");
  });

  it("keeps the page offset by default, so every pre-existing caller is unaffected", async () => {
    const el = await render(
      <PinnedAction label="Confirm week" formAction={noop} />
    );
    const wrap = el.querySelector("[data-pinned-action]");
    expect(wrap?.className).toContain("bottom-32");
    expect(wrap?.className).not.toContain("bottom-0");
  });
});
