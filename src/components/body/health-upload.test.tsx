// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { computeAccessibleName } from "dom-accessibility-api";
import * as matchers from "vitest-axe/matchers";
import { axe } from "vitest-axe";
import { HealthUpload } from "./health-upload";

// See src/components/ui/collapsible.test.tsx for why matchers are
// registered by hand rather than via vitest-axe/extend-expect.
expect.extend(matchers);

// Rendering by hand means opting into act() support ourselves, same as
// tests/journal-form.test.tsx.
declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement;

async function renderUpload() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<HealthUpload />);
  });
}

async function click(el: Element) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
  container?.remove();
});

describe("HealthUpload", () => {
  it("folds away by default — Labs is for reading results, not entering them", () => {
    const html = renderToString(<HealthUpload />);
    expect(html).toContain("collapsible-trigger");
    expect(html).toContain("Add a blood test");
  });

  it("holds the floor across the form", async () => {
    // The panel is closed by default and Base UI unmounts a closed panel's
    // content, so a renderToString() of the closed component would assert
    // over markup that contains none of what this test claims to check
    // (whole-branch review 2026-08-13, C1). Open it first, and pin a sanity
    // line naming something only the open panel renders — so this test can
    // never again pass against an empty string.
    await renderUpload();
    const trigger = container.querySelector("button");
    if (!trigger) throw new Error("collapsible trigger button not found");
    await click(trigger);

    const html = container.innerHTML;
    expect(html).toContain("Extract");
    expect(html).not.toMatch(/text-\[\d/);
    expect(html).not.toContain("text-white/");
    expect(html).not.toContain("bg-white/");
    expect(html).not.toContain("border-white/");
  });

  /**
   * v0.102 task 10 — the job outside the brief. Task 1's axe capture found
   * one theme-independent violation on this tab: the bare
   * `<input type="file">` here had no accessible name at all (no wrapping
   * `<label>`, no aria-label, no aria-labelledby, no title). The panel is a
   * closed-by-default Collapsible, so the trigger must be opened first — a
   * renderToString() against the closed default would assert over an empty
   * string and pass vacuously either way.
   *
   * This checks the actual computed accessible name (dom-accessibility-api,
   * the same engine @testing-library and axe-core use for the "label"
   * rule), not just that some labelling attribute string is present in the
   * markup — an aria-label typo or a `for`/`id` mismatch would still leave
   * the input unnamed and this test would catch it where a string-contains
   * check would not.
   */
  describe("the file input's accessible name (axe `label` fix, Task 1)", () => {
    async function openPanel() {
      await renderUpload();
      const trigger = container.querySelector("button");
      if (!trigger) throw new Error("collapsible trigger button not found");
      await click(trigger);
    }

    it("opens onto the real upload form, not an empty panel", async () => {
      await openPanel();
      // Sanity guard: names something only the open panel renders, so the
      // assertions below are checking real markup.
      expect(container.innerHTML).toContain("Extract");
    });

    it("gives the file input a real accessible name", async () => {
      await openPanel();
      const fileInput = container.querySelector('input[type="file"]');
      expect(fileInput).not.toBeNull();
      expect(computeAccessibleName(fileInput as HTMLElement)).toBe("File");
    });

    it("has no axe `label` violation once the form is open", async () => {
      await openPanel();
      const results = await axe(container, {
        runOnly: { type: "rule", values: ["label"] },
      });
      expect(results).toHaveNoViolations();
    });
  });
});
