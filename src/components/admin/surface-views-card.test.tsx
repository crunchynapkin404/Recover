// @vitest-environment jsdom
import { describe, expect, it, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SurfaceViewsCard } from "./surface-views-card";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function render(rows: { surface: string; total: number }[]) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<SurfaceViewsCard rows={rows} />));
}

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("SurfaceViewsCard", () => {
  it("lists surfaces with their totals", () => {
    render([
      { surface: "today", total: 42 },
      { surface: "train", total: 7 },
    ]);
    expect(container.textContent).toContain("today");
    expect(container.textContent).toContain("42");
    expect(container.textContent).toContain("train");
  });

  it("says so plainly when nothing has been recorded yet", () => {
    render([]);
    expect(container.textContent).toContain("No views recorded yet");
  });
});
