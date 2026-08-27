// @vitest-environment jsdom
// jsdom, not node: this file was a pure unit test over staleSilenceDays, and
// the flow strand's mechanism note is only observable once the card renders.
// The sibling connector tests are all jsdom for the same reason.
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AppleHealthCard, staleSilenceDays } from "./apple-health-card";
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

const NOW = new Date("2026-08-02T07:00:00Z");

function daysAgo(n: number): string {
  return new Date(NOW.getTime() - n * 86_400_000).toISOString();
}

describe("staleSilenceDays", () => {
  // The real apple_health connection sat status='active' for days after
  // Health Auto Export's paid trial ended, still reading as healthy. A push
  // connector has no failure signal — silence is the only symptom.
  it("reports the silence once a push connector has clearly stopped", () => {
    expect(staleSilenceDays(daysAgo(9), NOW)).toBe(9);
    expect(staleSilenceDays(daysAgo(3), NOW)).toBe(3);
  });

  it("stays quiet while the push is still plausibly live", () => {
    expect(staleSilenceDays(daysAgo(0), NOW)).toBeNull();
    expect(staleSilenceDays(daysAgo(1), NOW)).toBeNull();
    expect(staleSilenceDays(daysAgo(2), NOW)).toBeNull();
  });

  it("says nothing when the connector has never received anything", () => {
    expect(staleSilenceDays(null, NOW)).toBeNull();
  });

  it("does not report NaN days for an unparseable timestamp", () => {
    expect(staleSilenceDays("not-a-date", NOW)).toBeNull();
  });
});

describe("AppleHealthCard's mechanism note (flow strand)", () => {
  it("says Enable sets up a push from the athlete's own device", async () => {
    const el = await render(
      <AppleHealthCard connected={false} lastSyncAt={null} baseUrlConfigured />
    );
    expect(el.textContent).toContain("Stays here");
    expect(el.textContent).toContain("iPhone");
    expect(
      el
        .querySelector("button[aria-describedby]")
        ?.getAttribute("aria-describedby")
    ).toBe(mechanismNoteId("Apple Health"));
  });

  it("drops the note once the push is live", async () => {
    const el = await render(
      <AppleHealthCard connected lastSyncAt={null} baseUrlConfigured />
    );
    expect(el.querySelector("[id$='-mechanism']")).toBeNull();
  });
});
