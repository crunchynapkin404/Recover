// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("@/app/settings/strava-actions", () => ({
  stravaDisconnect: vi.fn(),
  stravaSyncNow: vi.fn(),
  setAutoDescribeStrava: vi.fn(),
  setStravaDescriptionFields: vi.fn(),
  previewStravaDescription: vi.fn(async () => null),
}));

import { StravaCard } from "./strava-card";

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

const connected = (writeEnabled: boolean) => ({
  athleteName: "Bart",
  status: "active",
  lastSyncAt: null,
  lastError: null,
  writeEnabled,
});

describe("StravaCard", () => {
  it("offers Sync and Disconnect when connected", async () => {
    const el = await render(
      <StravaCard
        configured
        connection={connected(true)}
        autoDescribe={false}
        descriptionFields={{}}
      />
    );
    expect(el.textContent).toContain("Connected as Bart");
    expect(el.textContent).toContain("Sync");
    expect(el.textContent).toContain("Disconnect");
  });

  it("offers Connect when configured but not connected", async () => {
    const el = await render(
      <StravaCard
        configured
        connection={null}
        autoDescribe={false}
        descriptionFields={{}}
      />
    );
    const link = el.querySelector("a[href='/api/connections/strava']");
    expect(link?.textContent).toBe("Connect");
  });

  it("names the missing env var when not configured", async () => {
    const el = await render(
      <StravaCard
        configured={false}
        connection={null}
        autoDescribe={false}
        descriptionFields={{}}
      />
    );
    expect(el.textContent).toContain("Set STRAVA_CLIENT_ID");
    expect(el.querySelector("a[href='/api/connections/strava']")).toBeNull();
  });

  it("surfaces an OAuth error param as a live region", async () => {
    const el = await render(
      <StravaCard
        configured
        connection={null}
        autoDescribe={false}
        descriptionFields={{}}
        errorParam="denied"
      />
    );
    expect(el.querySelector("[role='status']")?.textContent).toBe(
      "You declined the Strava authorization."
    );
  });

  it("prompts to reconnect when the connection cannot write", async () => {
    const el = await render(
      <StravaCard
        configured
        connection={connected(false)}
        autoDescribe={false}
        descriptionFields={{}}
      />
    );
    expect(el.textContent).toContain(
      "Upgrade Strava connection for AI descriptions"
    );
    expect(el.textContent).toContain("Reconnect");
  });

  it("offers the auto-describe toggle only when writes are enabled", async () => {
    const el = await render(
      <StravaCard
        configured
        connection={connected(true)}
        autoDescribe={false}
        descriptionFields={{}}
      />
    );
    expect(el.textContent).toContain("Auto-describe new activities on Strava");
    expect(el.querySelector("input[type='checkbox']")).not.toBeNull();
  });

  it("hides the auto-describe toggle when writes are not enabled", async () => {
    const el = await render(
      <StravaCard
        configured
        connection={connected(false)}
        autoDescribe={false}
        descriptionFields={{}}
      />
    );
    expect(el.textContent).not.toContain("Auto-describe new activities");
    expect(el.querySelector("input[type='checkbox']")).toBeNull();
  });
});
