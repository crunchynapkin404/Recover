// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

// Same shim bottom-sheet.test.tsx and the train page tests need —
// SidebarNav/BottomNav (children of AppShell) call usePathname directly.
vi.mock("next/navigation", () => ({
  usePathname: () => "/train",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));

import { AppShell } from "./app-shell";

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

/**
 * I3, final whole-branch review: `bottom-sheet.tsx` had no initial focus
 * move, no focus trap and no focus restore, and this shell rendered the
 * overlay as the last DOM node with the background neither `inert` nor
 * `aria-hidden` — so a keyboard/AT user who opened a sheet had to Tab past
 * every page control plus BottomNav to reach a panel `aria-modal="true"`
 * already (falsely) claimed was modal. The background-inert half of the
 * fix belongs here, at the shell, computed straight from `overlay`'s own
 * truthiness at render time — no client effect needed for this half, only
 * the focus move/trap/restore inside BottomSheet does (bottom-sheet.test.tsx).
 */
describe("AppShell's background marker", () => {
  // AppShell no longer decides when the background is inert — BottomSheet
  // does, on mount, because only a mounted modal knows a modal is visible.
  // Deriving it from the `overlay` prop's truthiness shipped two page-killing
  // bugs in two commits (Today's always-truthy <SheetHost/>, Coach's
  // lg:hidden history panel). What AppShell owes BottomSheet is this marker.
  it("marks the background subtree so a sheet can find it", async () => {
    const el = await render(<AppShell user={null}>content</AppShell>);
    expect(el.querySelector("[data-app-background]")).not.toBeNull();
  });

  it("never marks the overlay itself as background", async () => {
    const el = await render(
      <AppShell user={null} overlay={<div data-testid="ov">sheet</div>}>
        content
      </AppShell>
    );
    const background = el.querySelector("[data-app-background]");
    expect(background?.querySelector('[data-testid="ov"]')).toBeNull();
  });

  it("does not set inert itself, whatever the overlay prop holds", async () => {
    const el = await render(
      <AppShell user={null} overlay={<div>hidden on desktop</div>}>
        content
      </AppShell>
    );
    expect(el.querySelector("[inert]")).toBeNull();
  });
});
