// @vitest-environment jsdom
import { describe, expect, it, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SurfaceViewsCard, groupSurfaces } from "./surface-views-card";

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

  it("folds tab keys under their parent and totals both eras", () => {
    render([
      { surface: "train", total: 10 }, // pre-v0.121 rows
      { surface: "train:week", total: 30 },
      { surface: "train:season", total: 2 },
      { surface: "today", total: 5 },
    ]);
    const g = groupSurfaces([
      { surface: "train", total: 10 },
      { surface: "train:week", total: 30 },
      { surface: "train:season", total: 2 },
      { surface: "today", total: 5 },
    ]);
    expect(g.map((x) => x.surface)).toEqual(["train", "today"]);
    expect(g[0].total).toBe(42);
    expect(g[0].own).toBe(10);
    expect(g[0].tabs).toEqual([
      { tab: "week", total: 30 },
      { tab: "season", total: 2 },
    ]);
    // train (42) now outranks today (5) although its bare row is only 10 —
    // sorting on the bare key alone would bury the busiest surface.
    expect(container.textContent).toContain("untabbed · before v0.121");
  });

  it("omits the pre-v0.121 line when a surface has no untabbed rows", () => {
    render([{ surface: "body:labs", total: 3 }]);
    expect(container.textContent).toContain("labs");
    expect(container.textContent).not.toContain("before v0.121");
  });

  it("nests a deeper key under its first segment rather than dropping it", () => {
    const g = groupSurfaces([{ surface: "train:history:month", total: 4 }]);
    expect(g).toHaveLength(1);
    expect(g[0].surface).toBe("train");
    expect(g[0].tabs).toEqual([{ tab: "history:month", total: 4 }]);
  });
});
