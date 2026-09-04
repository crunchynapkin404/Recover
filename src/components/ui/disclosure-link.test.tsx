// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DisclosureLink } from "./disclosure-link";

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

describe("DisclosureLink", () => {
  it("is a link, not a button — it navigates", async () => {
    const el = await render(
      <DisclosureLink
        href="/train?sheet=fuelling&day=2026-09-04"
        label="How to fuel this session"
      />
    );
    const a = el.querySelector("a");
    expect(a).not.toBeNull();
    expect(a!.getAttribute("href")).toBe(
      "/train?sheet=fuelling&day=2026-09-04"
    );
    expect(el.querySelector("button")).toBeNull();
  });

  it("carries an accessible name that says what it discloses", async () => {
    const el = await render(
      <DisclosureLink href="/x" label="How to fuel this session" />
    );
    expect(el.querySelector("a")!.textContent).toContain(
      "How to fuel this session"
    );
  });

  it("refuses a name that says nothing", async () => {
    // "Info" beside three different figures teaches a screen-reader user
    // nothing — the defect the connector cards' aria-describedby fix closed.
    expect(() => DisclosureLink({ href: "/x", label: "Info" })).toThrow(
      /says what it discloses/i
    );
  });

  it("hides the glyph from assistive technology", async () => {
    const el = await render(
      <DisclosureLink href="/x" label="Why this week's volume" />
    );
    expect(el.querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
  });
});
