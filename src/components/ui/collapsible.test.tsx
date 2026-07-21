// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import * as matchers from "vitest-axe/matchers";
import { axe } from "vitest-axe";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsiblePanel,
} from "./collapsible";

// vitest-axe (0.1.0, last published years ago) ships a broken/empty
// `vitest-axe/extend-expect` entry point for this Vitest version — importing
// it registers nothing and `toHaveNoViolations` throws "Invalid Chai
// property". The matchers themselves (`vitest-axe/matchers`) work fine, so
// register them by hand instead. See docs/a11y-sweep-2026-07.md.
expect.extend(matchers);

function Example({
  defaultOpen,
  open,
  onOpenChange,
}: {
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <Collapsible
      defaultOpen={defaultOpen}
      open={open}
      onOpenChange={onOpenChange}
    >
      <CollapsibleTrigger badge={<span>3</span>}>
        Recovery Metrics
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <p>HRV Trend 52ms</p>
      </CollapsiblePanel>
    </Collapsible>
  );
}

describe("Collapsible", () => {
  it("defaults to closed when no defaultOpen is given", () => {
    const html = renderToString(<Example />);
    expect(html).not.toContain("data-panel-open");
  });

  it("renders open when defaultOpen is true", () => {
    const html = renderToString(<Example defaultOpen />);
    expect(html).toContain("data-panel-open");
  });

  it("renders the trigger's badge slot", () => {
    const html = renderToString(<Example />);
    expect(html).toContain(">3<");
  });

  describe("controlled interaction", () => {
    let container: HTMLDivElement;
    let root: Root;

    function renderControlled(onOpenChange: (open: boolean) => void) {
      container = document.createElement("div");
      document.body.appendChild(container);
      act(() => {
        root = createRoot(container);
        root.render(<Example open={false} onOpenChange={onOpenChange} />);
      });
    }

    it("calls onOpenChange(true) when the trigger is clicked", () => {
      let lastOpen: boolean | null = null;
      renderControlled((open) => {
        lastOpen = open;
      });
      const trigger = container.querySelector("button");
      if (!trigger) throw new Error("trigger button not found");
      act(() => {
        trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      expect(lastOpen).toBe(true);
    });
  });

  // This is the exact accordion pattern used for every settings domain
  // section (src/app/settings/page.tsx), the journal form's numbered steps,
  // and the coach composer's Chat History / Quick Context sections — so
  // covering it here covers all of those call sites at once.
  describe("accessibility", () => {
    let container: HTMLDivElement;
    let root: Root;

    function mount(el: React.ReactElement) {
      container = document.createElement("div");
      document.body.appendChild(container);
      act(() => {
        root = createRoot(container);
        root.render(el);
      });
    }

    it("has no axe violations when closed (default)", async () => {
      mount(<Example />);
      expect(await axe(container)).toHaveNoViolations();
    });

    it("has no axe violations when open", async () => {
      mount(<Example defaultOpen />);
      expect(await axe(container)).toHaveNoViolations();
    });

    it("closed panel content is not reachable by keyboard tab order", () => {
      mount(<Example />);
      const panelText = Array.from(container.querySelectorAll("p")).find(
        (p) => p.textContent === "HRV Trend 52ms"
      );
      // base-ui's Collapsible.Panel sets `hidden` once a closed panel is no
      // longer animating — `hidden` removes the subtree from both the
      // accessibility tree and tab order. This guards the v0.19 "collapsed
      // sections skip their hidden content" focus-order requirement.
      expect(panelText?.closest("[hidden]")).not.toBeNull();
    });
  });
});
