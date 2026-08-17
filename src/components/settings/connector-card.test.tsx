// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  ConnectorCard,
  connectorBadgeClass,
  connectorCtaClass,
  connectorGhostClass,
  connectorPillClass,
  TONE_CHIP,
} from "./connector-card";

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

// These four strings and TONE_CHIP's five entries were copied verbatim from
// the five existing connector cards (Task 2) and are exactly what Task 5
// migrates onto design tokens. Byte-identity here was previously checked
// only by manual diffing against those five files at write time — nothing
// caught drift after that. These pins are expected to change exactly once,
// in Task 5's commit; any other change to them is a regression.
describe("ConnectorCard class constants (pinned, see Task 5)", () => {
  it("connectorPillClass matches the Sync button's current class string", () => {
    expect(connectorPillClass).toBe(
      "rounded-full border border-hairline bg-surface-overlay px-3 py-1.5 text-label font-bold uppercase tracking-wider transition-colors hover:bg-surface-selected disabled:opacity-50"
    );
  });

  it("connectorGhostClass matches the Disconnect button's current class string", () => {
    expect(connectorGhostClass).toBe(
      "rounded-full border border-hairline px-3 py-1.5 text-label font-bold uppercase tracking-wider text-ink-muted transition-colors hover:bg-destructive-tint hover:text-destructive-ink disabled:opacity-50"
    );
  });

  it("connectorCtaClass matches the Connect action's current class string", () => {
    expect(connectorCtaClass).toBe(
      "rounded-full bg-accent px-4 py-2 text-label font-bold uppercase tracking-wider text-accent-foreground transition-colors hover:opacity-90 disabled:opacity-50"
    );
  });

  it('connectorBadgeClass matches the "Set X_CLIENT_ID" badge\'s current class string', () => {
    expect(connectorBadgeClass).toBe(
      "rounded bg-surface-overlay px-2 py-1 text-label font-bold uppercase tracking-widest text-ink-muted"
    );
  });

  it("TONE_CHIP holds each brand's current avatar-chip classes", () => {
    expect(TONE_CHIP).toEqual({
      strava: "bg-connector-strava-tint text-connector-strava-ink",
      whoop: "bg-connector-whoop-tint text-connector-whoop-ink",
      withings: "bg-connector-withings-tint text-connector-withings-ink",
      oura: "bg-connector-oura-tint text-connector-oura-ink",
      apple: "bg-connector-apple-tint text-connector-apple-ink",
    });
  });
});
