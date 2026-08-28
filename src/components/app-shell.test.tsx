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
describe("AppShell", () => {
  it("leaves the background reachable when no sheet overlay is mounted", async () => {
    const el = await render(
      <AppShell>
        <button>Page control</button>
      </AppShell>
    );
    const btn = el.querySelector("button");
    expect(btn).not.toBeNull();
    expect(btn!.closest("[inert]")).toBeNull();
    // BottomNav's own links must stay reachable too, not just `children`.
    const navLink = el.querySelector("nav a");
    expect(navLink).not.toBeNull();
    expect(navLink!.closest("[inert]")).toBeNull();
  });

  it("marks the background inert while a sheet overlay is mounted, but leaves the overlay itself reachable", async () => {
    const el = await render(
      <AppShell overlay={<div role="dialog">Sheet</div>}>
        <button>Page control</button>
      </AppShell>
    );
    const btn = el.querySelector("button");
    expect(btn).not.toBeNull();
    expect(btn!.closest("[inert]")).not.toBeNull();
    const navLink = el.querySelector("nav a");
    expect(navLink).not.toBeNull();
    expect(navLink!.closest("[inert]")).not.toBeNull();
    // The overlay is a sibling of the inert wrapper (see the component's
    // own doc comment on why), so it must never itself be inert.
    const dialog = el.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog!.closest("[inert]")).toBeNull();
  });

  it("clears inert again once the overlay unmounts", async () => {
    function Wrapper({ open }: { open: boolean }) {
      return (
        <AppShell overlay={open ? <div role="dialog">Sheet</div> : null}>
          <button>Page control</button>
        </AppShell>
      );
    }
    const el = await render(<Wrapper open={true} />);
    expect(el.querySelector("button")!.closest("[inert]")).not.toBeNull();
    await act(async () => {
      root!.render(<Wrapper open={false} />);
    });
    expect(el.querySelector("button")!.closest("[inert]")).toBeNull();
  });
});
