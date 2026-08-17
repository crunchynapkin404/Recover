// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("@/app/settings/oura-actions", () => ({
  connectOura: vi.fn(),
  ouraDisconnect: vi.fn(),
  ouraSyncNow: vi.fn(),
}));

// useActionState is mocked directly, the same shape webhooks-card.test.tsx
// uses for its own useActionState-backed state, so the disconnected-with-
// connect-failure-message case (finding 1, whole-branch review fix wave)
// can be rendered in one synchronous pass instead of driving a real form
// submission through the mocked action. Everything else from react
// (useState, useTransition, act, ...) is the real implementation.
let mockConnectState: { ok: boolean; message: string } | null = null;
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useActionState: vi.fn(() => [mockConnectState, vi.fn(), false]),
  };
});

import { OuraCard } from "./oura-card";

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
  mockConnectState = null;
  if (root) {
    const r = root;
    await act(async () => r.unmount());
    root = null;
  }
  container?.remove();
});

describe("OuraCard", () => {
  it("offers Sync and Disconnect when connected", async () => {
    const el = await render(
      <OuraCard
        connection={{
          accountName: "bart@example.com",
          status: "active",
          lastSyncAt: null,
          lastError: null,
        }}
      />
    );
    expect(el.textContent).toContain("Sync");
    expect(el.textContent).toContain("Disconnect");
  });

  it("shows the token form with a required password input when disconnected", async () => {
    const el = await render(<OuraCard connection={null} />);
    const input = el.querySelector("input[name='token']");
    expect(input?.getAttribute("type")).toBe("password");
    expect(input?.hasAttribute("required")).toBe(true);
  });

  it("shows the help text when disconnected", async () => {
    const el = await render(<OuraCard connection={null} />);
    expect(el.textContent).toContain("Personal Access Tokens");
  });

  it("renders a lastError as a live region", async () => {
    const el = await render(
      <OuraCard
        connection={{
          accountName: "",
          status: "error",
          lastSyncAt: null,
          lastError: "token expired",
        }}
      />
    );
    expect(el.querySelector("[role='status']")?.textContent).toBe(
      "Last error: token expired"
    );
  });

  // Finding 1, whole-branch review fix wave (2026-08-17): the shell renders
  // `status` before `{children}`, so this is the DOM-order case oura-card.tsx's
  // new comment (near its `status` prop) describes as previously uncovered —
  // disconnected (`connection: null`, still rendering the token form and
  // help text) together with a connect-failure message.
  it("renders a connect-failure message as a live region when disconnected", async () => {
    mockConnectState = { ok: false, message: "Oura rejected that token." };
    const el = await render(<OuraCard connection={null} />);
    const status = el.querySelector("[role='status']");
    expect(status).not.toBeNull();
    expect(status?.textContent).toBe("Oura rejected that token.");
    // Still disconnected, so the token form is present too — this is the
    // case that puts the status paragraph ahead of the form in the DOM.
    expect(el.querySelector("input[name='token']")).not.toBeNull();
  });
});
