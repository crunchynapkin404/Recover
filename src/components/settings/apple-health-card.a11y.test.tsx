// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { computeAccessibleName } from "dom-accessibility-api";
import * as matchers from "vitest-axe/matchers";
import { axe } from "vitest-axe";
import { AppleHealthCard } from "./apple-health-card";

// See src/components/ui/collapsible.test.tsx for why matchers are registered
// by hand rather than via vitest-axe/extend-expect.
expect.extend(matchers);

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement;

async function renderCard() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <AppleHealthCard
        connected={true}
        lastSyncAt={new Date().toISOString()}
        baseUrlConfigured={true}
      />
    );
  });
}

afterEach(async () => {
  if (root) {
    const r = root;
    await act(async () => r.unmount());
    root = null;
  }
  container?.remove();
});

/**
 * v0.99 slice 5 (v0.105.0). The Settings capture had never opened any of the
 * page's five <Collapsible> sections, so the Integrations section — and this
 * card's one-off upload form inside it — had never been axe-audited at all.
 * Widening the capture surfaced a `label` violation of **critical** impact
 * that is theme-independent, and therefore live for the athlete today rather
 * than waiting for light mode to become reachable at slice 9: this
 * `<input type="file">` had no accessible name of any kind — no wrapping
 * <label>, no aria-label, no aria-labelledby, no title.
 *
 * Exactly the defect slice 3 fixed on src/components/body/health-upload.tsx,
 * in a different section of a different surface, found the same way — by
 * opening something the tooling had never opened. This test is modelled on
 * that one deliberately.
 *
 * It checks the computed accessible name via dom-accessibility-api — the same
 * engine @testing-library and axe-core's `label` rule use — rather than
 * asserting that some labelling attribute appears in the markup. A `for`/`id`
 * mismatch or an aria-label typo would leave the input unnamed while a
 * string-contains check still passed.
 */
describe("AppleHealthCard's file input (axe `label` fix, slice 5)", () => {
  it("renders the upload form this test is asserting over", async () => {
    await renderCard();
    // Sanity guard: if the form ever moves behind a toggle, the assertions
    // below would pass vacuously against markup that is not there.
    expect(container.querySelector('input[type="file"]')).not.toBeNull();
  });

  it("gives the file input a real accessible name", async () => {
    await renderCard();
    const fileInput = container.querySelector('input[type="file"]');
    expect(computeAccessibleName(fileInput as HTMLElement)).toBe("File");
  });

  it("has no axe `label` violation", async () => {
    await renderCard();
    const results = await axe(container, {
      runOnly: { type: "rule", values: ["label"] },
    });
    expect(results).toHaveNoViolations();
  });
});
