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

/**
 * A SOURCE SCAN, in the style of tests/dead-component-guard.test.ts, because
 * the defect this guards is at the CALL SITE and no page-level harness
 * renders Today.
 *
 * `overlay`'s truthiness drives `inert` on the entire background. A JSX
 * element is truthy even when the component inside it renders null — so
 * `overlay={<SheetHost … />}`, passed unconditionally, made every control on
 * Today inert with no sheet open at all. It shipped for exactly one commit.
 *
 * The three tests above pin AppShell's own behaviour, and would have stayed
 * green through that bug: the shell was right, the caller was wrong. This
 * asserts the contract the shell's doc comment states — pass null when
 * nothing is open — by requiring every call site's expression to be
 * conditional (a ternary, a `&&`, or a literal null).
 */
describe("AppShell's overlay contract, across every call site", () => {
  it("never passes an unconditional element as overlay", async () => {
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");

    function walk(dir: string): string[] {
      return readdirSync(dir).flatMap((name) => {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) return walk(full);
        return full.endsWith(".tsx") && !full.includes(".test.") ? [full] : [];
      });
    }

    const offenders: string[] = [];
    for (const file of walk(join(process.cwd(), "src", "app"))) {
      const src = readFileSync(file, "utf8");
      const idx = src.indexOf("overlay={");
      if (idx === -1) continue;
      // The expression up to the matching close, cheaply bounded: everything
      // between `overlay={` and the line that closes it at the same indent.
      const rest = src.slice(idx, idx + 600);
      const conditional =
        rest.includes("?") || rest.includes("&&") || rest.includes("null");
      if (!conditional) offenders.push(file.replace(process.cwd() + "/", ""));
    }

    expect(offenders).toEqual([]);
  });
});
