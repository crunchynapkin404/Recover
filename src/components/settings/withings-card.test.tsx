// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("@/app/settings/withings-actions", () => ({
  withingsDisconnect: vi.fn(),
  withingsSyncNow: vi.fn(),
}));

import { WithingsCard } from "./withings-card";
import { mechanismNoteId } from "./connector-card";

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

describe("WithingsCard", () => {
  it("offers Sync and Disconnect when connected", async () => {
    const el = await render(
      <WithingsCard
        configured
        connection={{
          status: "active",
          lastSyncAt: null,
          lastError: null,
        }}
      />
    );
    expect(el.textContent).toContain("Connected");
    expect(el.textContent).toContain("Sync");
    expect(el.textContent).toContain("Disconnect");
  });

  it("offers Connect when configured but not connected", async () => {
    const el = await render(<WithingsCard configured connection={null} />);
    const link = el.querySelector("a[href='/api/connections/withings']");
    expect(link?.textContent).toBe("Connect");
  });

  it("names the missing env var when not configured", async () => {
    const el = await render(
      <WithingsCard configured={false} connection={null} />
    );
    expect(el.textContent).toContain("Set WITHINGS_CLIENT_ID");
    expect(el.querySelector("a[href='/api/connections/withings']")).toBeNull();
  });

  it("surfaces an OAuth error param as a live region", async () => {
    const el = await render(
      <WithingsCard configured connection={null} errorParam="denied" />
    );
    expect(el.querySelector("[role='status']")?.textContent).toBe(
      "You declined the Withings authorization."
    );
  });
});

describe("WithingsCard's mechanism note (flow strand)", () => {
  it("tells the athlete Connect will leave for Withings", async () => {
    const el = await render(<WithingsCard configured connection={null} />);
    expect(el.textContent).toContain("Sends you to Withings to sign in");
    expect(
      el
        .querySelector("a[href='/api/connections/withings']")
        ?.getAttribute("aria-describedby")
    ).toBe(mechanismNoteId("Withings"));
  });
});
