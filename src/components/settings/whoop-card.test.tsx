// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("@/app/settings/whoop-actions", () => ({
  whoopDisconnect: vi.fn(),
  whoopSyncNow: vi.fn(),
}));

import { WhoopCard } from "./whoop-card";
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

describe("WhoopCard", () => {
  it("offers Sync and Disconnect when connected", async () => {
    const el = await render(
      <WhoopCard
        configured
        connection={{
          athleteName: "Bart",
          status: "active",
          lastSyncAt: null,
          lastError: null,
        }}
      />
    );
    expect(el.textContent).toContain("Connected as Bart");
    expect(el.textContent).toContain("Sync");
    expect(el.textContent).toContain("Disconnect");
  });

  it("offers Connect when configured but not connected", async () => {
    const el = await render(<WhoopCard configured connection={null} />);
    const link = el.querySelector("a[href='/api/connections/whoop']");
    expect(link?.textContent).toBe("Connect");
  });

  it("names the missing env var when not configured", async () => {
    const el = await render(<WhoopCard configured={false} connection={null} />);
    expect(el.textContent).toContain("Set WHOOP_CLIENT_ID");
    expect(el.querySelector("a[href='/api/connections/whoop']")).toBeNull();
  });

  it("surfaces an OAuth error param as a live region", async () => {
    const el = await render(
      <WhoopCard configured connection={null} errorParam="denied" />
    );
    expect(el.querySelector("[role='status']")?.textContent).toBe(
      "You declined the Whoop authorization."
    );
  });
});

describe("WhoopCard's mechanism note (flow strand)", () => {
  it("tells the athlete Connect will leave for Whoop", async () => {
    const el = await render(<WhoopCard configured connection={null} />);
    expect(el.textContent).toContain("Sends you to Whoop to sign in");
  });

  it("points Connect at that sentence for assistive tech", async () => {
    const el = await render(<WhoopCard configured connection={null} />);
    const link = el.querySelector("a[href='/api/connections/whoop']");
    expect(link?.getAttribute("aria-describedby")).toBe(
      mechanismNoteId("Whoop")
    );
  });

  it("drops the note once connected — there is nothing left to enter", async () => {
    const el = await render(
      <WhoopCard
        configured
        connection={{
          athleteName: "Bart",
          status: "active",
          lastSyncAt: null,
          lastError: null,
        }}
      />
    );
    expect(el.textContent).not.toContain("Sends you to Whoop");
  });

  it("stays quiet when the connector cannot be connected at all", async () => {
    const el = await render(<WhoopCard configured={false} connection={null} />);
    expect(el.textContent).not.toContain("Sends you to Whoop");
  });
});
