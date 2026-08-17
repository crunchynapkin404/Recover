// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("@/app/settings/oura-actions", () => ({
  connectOura: vi.fn(),
  ouraDisconnect: vi.fn(),
  ouraSyncNow: vi.fn(),
}));

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
});
