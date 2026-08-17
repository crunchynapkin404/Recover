// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import * as matchers from "vitest-axe/matchers";
import { axe } from "vitest-axe";
import { ConnectorCard, connectorPillClass } from "./connector-card";

// See src/components/ui/collapsible.test.tsx for why matchers are registered
// by hand rather than via vitest-axe/extend-expect.
expect.extend(matchers);

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement;

afterEach(async () => {
  if (root) {
    const r = root;
    await act(async () => r.unmount());
    root = null;
  }
  container?.remove();
});

describe("ConnectorCard accessibility", () => {
  it("has no axe violations in its connected state", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <ConnectorCard
          name="Strava"
          tone="strava"
          glyph="↗"
          subtitle="Connected as Bart"
          status={{ message: "Synced", ok: true }}
          actions={
            <button type="button" className={connectorPillClass}>
              Sync
            </button>
          }
        />
      );
    });
    expect(await axe(container)).toHaveNoViolations();
  });
});
