// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SeasonProgress } from "./season-progress";

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

describe("SeasonProgress", () => {
  it("shows progress and the weeks left when both are known", async () => {
    const el = await render(
      <SeasonProgress
        progressPct={17}
        weeksToRace={5}
        raceName="Autumn Marathon"
      />
    );
    expect(el.textContent).toContain("17%");
    expect(el.textContent).toContain("5");
    expect(el.textContent).toContain("WEEKS TO RACE");
  });

  // The engine computes progress from plan weeks elapsed against total. An
  // athlete between plans has no such figure, and inventing 0% would read as
  // "you have done nothing" rather than "there is nothing to measure".
  it("says nothing at all when there is no plan to progress through", async () => {
    const el = await render(
      <SeasonProgress progressPct={null} weeksToRace={null} raceName={null} />
    );
    expect(el.querySelector("[data-season-progress]")).toBeNull();
  });

  it("still shows progress when no race is scheduled", async () => {
    const el = await render(
      <SeasonProgress progressPct={40} weeksToRace={null} raceName={null} />
    );
    expect(el.textContent).toContain("40%");
    expect(el.textContent).not.toContain("WEEKS TO RACE");
  });
});
