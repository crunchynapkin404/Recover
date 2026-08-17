// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ConnectorCard } from "./connector-card";

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

describe("ConnectorCard", () => {
  it("renders the provider name, subtitle and avatar glyph", async () => {
    const el = await render(
      <ConnectorCard
        name="Withings"
        tone="withings"
        glyph="⚖"
        subtitle="Weight, body composition, blood pressure"
      />
    );
    expect(el.textContent).toContain("Withings");
    expect(el.textContent).toContain("Weight, body composition");
    expect(el.textContent).toContain("⚖");
  });

  it("hides the avatar glyph from assistive tech", async () => {
    const el = await render(
      <ConnectorCard
        name="Oura"
        tone="oura"
        glyph="◍"
        subtitle="Staged sleep"
      />
    );
    // The glyph is decoration; the provider name carries the meaning.
    const hidden = el.querySelector("[aria-hidden]");
    expect(hidden?.textContent).toBe("◍");
  });

  it("renders no status paragraph when status is null", async () => {
    const el = await render(
      <ConnectorCard name="Whoop" tone="whoop" glyph="W" subtitle="HRV" />
    );
    expect(el.querySelector("[role='status']")).toBeNull();
  });

  it("renders the status message as a live region when given one", async () => {
    const el = await render(
      <ConnectorCard
        name="Whoop"
        tone="whoop"
        glyph="W"
        subtitle="HRV"
        status={{ message: "Synced 42 activities", ok: true }}
      />
    );
    const status = el.querySelector("[role='status']");
    expect(status?.textContent).toBe("Synced 42 activities");
  });

  it("renders actions and per-provider children in document order", async () => {
    const el = await render(
      <ConnectorCard
        name="Strava"
        tone="strava"
        glyph="↗"
        subtitle="Connected as Bart"
        actions={<button type="button">Sync</button>}
      >
        <p>Auto-describe new activities</p>
      </ConnectorCard>
    );
    expect(el.textContent).toContain("Sync");
    expect(el.textContent).toContain("Auto-describe new activities");
    const text = el.textContent ?? "";
    expect(text.indexOf("Sync")).toBeLessThan(
      text.indexOf("Auto-describe new activities")
    );
  });
});
