// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsiblePanel,
} from "./collapsible";

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
});
