// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SummaryRow } from "./summary-row";

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

describe("SummaryRow", () => {
  it("is a link to its destination, not a button that toggles", async () => {
    const el = await render(
      <SummaryRow
        label="Why this week"
        badge="4"
        href="/train?sheet=why-week"
      />
    );
    const a = el.querySelector("a");
    expect(a?.getAttribute("href")).toBe("/train?sheet=why-week");
    expect(el.querySelector("button")).toBeNull();
  });

  // The whole point of the slice: a drawer keeps its contents in the DOM,
  // costed by assistive technology and counted by the choice-load
  // measurement. A row must not secretly render the panel it links to.
  it("renders none of the destination's content", async () => {
    const el = await render(
      <SummaryRow label="Races" badge="3" href="/train?sheet=races" />
    );
    expect(el.textContent).toBe("Races3");
  });

  it("omits the badge entirely when there is no count", async () => {
    const el = await render(
      <SummaryRow label="Plan setup" href="/train?sheet=plan-setup" />
    );
    expect(el.textContent).toBe("Plan setup");
  });
});
