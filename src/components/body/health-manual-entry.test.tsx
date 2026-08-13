// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { computeAccessibleName } from "dom-accessibility-api";
import { HealthManualEntry } from "./health-manual-entry";

// Rendering by hand means opting into act() support ourselves, same as
// health-upload.test.tsx and tests/journal-form.test.tsx.
declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement;

async function renderEntry() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<HealthManualEntry birthYear={null} />);
  });
}

async function click(el: Element) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

async function openPanel() {
  await renderEntry();
  const trigger = container.querySelector("button");
  if (!trigger) throw new Error("collapsible trigger button not found");
  await click(trigger);
}

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
  container?.remove();
});

describe("HealthManualEntry", () => {
  it("folds away by default — Labs is for reading results, not entering them", () => {
    const html = renderToString(<HealthManualEntry birthYear={null} />);
    expect(html).toContain("collapsible-trigger");
    expect(html).toContain("Your details &amp; blood pressure");
  });

  it("holds the floor across the form", async () => {
    // The panel is closed by default and Base UI unmounts a closed panel's
    // content, so a renderToString() of the closed component would assert
    // over markup that contains none of this form (see
    // health-upload.test.tsx's "holds the floor" test, C1 whole-branch
    // review 2026-08-13). Open it first, and pin a sanity line naming
    // something only the open panel renders.
    await openPanel();
    const html = container.innerHTML;
    expect(html).toContain("Log blood pressure");
    expect(html).not.toMatch(/text-\[\d/);
    expect(html).not.toContain("text-white/");
    expect(html).not.toContain("bg-white/");
    expect(html).not.toContain("border-white/");
  });

  it("uses h3 for both headings, not h2 — the CollapsibleTrigger primitive already wraps its child in an h3, and an h2 inside would skip a level", async () => {
    await openPanel();
    expect(container.querySelectorAll("h2").length).toBe(0);
    const headings = Array.from(container.querySelectorAll("h3")).map(
      (h) => h.textContent
    );
    expect(headings).toContain("Your details");
    expect(headings).toContain("Log blood pressure");
  });

  it("gives all four inputs a real accessible name from their wrapping label", async () => {
    await openPanel();
    const names = ["Birth year", "Date", "Systolic", "Diastolic"] as const;
    const inputs = container.querySelectorAll("input");
    expect(inputs.length).toBe(4);
    inputs.forEach((input, i) => {
      expect(computeAccessibleName(input as HTMLElement)).toBe(names[i]);
    });
  });
});
