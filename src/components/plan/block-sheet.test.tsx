// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { useState } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BlockSheet } from "./block-sheet";
import type { AvailabilityBlock } from "@/lib/availability/types";

const blocks = [
  {
    start: "18:00",
    end: "19:30",
    mins: 90,
    energy: "normal" as const,
    sports: null,
  },
];

describe("BlockSheet", () => {
  it("lists each block with its window and duration", () => {
    const html = renderToString(
      <BlockSheet
        dayLabel="Wednesday"
        blocks={blocks}
        sports={["Bike"]}
        onChange={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(html).toContain("Wednesday");
    expect(html).toContain("18:00");
    expect(html).toContain("1h 30m");
  });

  it("offers the three energy levels", () => {
    const html = renderToString(
      <BlockSheet
        dayLabel="Wednesday"
        blocks={blocks}
        sports={["Bike"]}
        onChange={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(html).toContain("Easy");
    expect(html).toContain("Normal");
    expect(html).toContain("Full gas");
  });

  it("says the day is a rest day when there are no blocks", () => {
    const html = renderToString(
      <BlockSheet
        dayLabel="Monday"
        blocks={[]}
        sports={["Bike"]}
        onChange={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(html).toContain("Rest");
  });

  it("shows sport chips only when the plan has more than one sport", () => {
    const one = renderToString(
      <BlockSheet
        dayLabel="Wednesday"
        blocks={blocks}
        sports={["Bike"]}
        onChange={vi.fn()}
        onClose={vi.fn()}
      />
    );
    const two = renderToString(
      <BlockSheet
        dayLabel="Wednesday"
        blocks={blocks}
        sports={["Bike", "Run"]}
        onChange={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(one).not.toContain("Run");
    expect(two).toContain("Run");
  });

  it("is a dialog with an accessible name naming the day", () => {
    const html = renderToString(
      <BlockSheet
        dayLabel="Wednesday"
        blocks={blocks}
        sports={["Bike"]}
        onChange={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(html).toContain('role="dialog"');
    expect(html).toMatch(/aria-label="[^"]*Wednesday[^"]*"/);
  });

  it("marks the selected energy level as pressed and the others as not", () => {
    const html = renderToString(
      <BlockSheet
        dayLabel="Wednesday"
        blocks={blocks}
        sports={["Bike"]}
        onChange={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(html).toMatch(/aria-pressed="true"[^>]*>Normal</);
    expect(html).toMatch(/aria-pressed="false"[^>]*>Easy</);
    expect(html).toMatch(/aria-pressed="false"[^>]*>Full gas</);
  });
});

describe("BlockSheet interactions", () => {
  let container: HTMLDivElement;
  let root: Root;

  function Harness({
    initial,
    sports,
  }: {
    initial: AvailabilityBlock[];
    sports: string[];
  }) {
    const [current, setCurrent] = useState(initial);
    return (
      <BlockSheet
        dayLabel="Wednesday"
        blocks={current}
        sports={sports}
        onChange={setCurrent}
        onClose={vi.fn()}
      />
    );
  }

  function mount(el: React.ReactElement) {
    container = document.createElement("div");
    document.body.appendChild(container);
    act(() => {
      root = createRoot(container);
      root.render(el);
    });
  }

  function click(el: Element | null | undefined) {
    expect(el).toBeTruthy();
    act(() => {
      el!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  }

  function findButton(text: string): HTMLButtonElement | undefined {
    return Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === text
    );
  }

  it("adding a block twice on a rest day surfaces the overlap error and keeps only the valid one", () => {
    mount(<Harness initial={[]} sports={["Bike"]} />);

    click(findButton("Add a block"));
    expect(container.textContent).not.toContain(
      "Rest — no time set for this day."
    );
    expect(container.querySelector('[role="alert"]')).toBeFalsy();

    click(findButton("Add a block"));
    const alert = container.querySelector('[role="alert"]');
    expect(alert).toBeTruthy();
    expect(alert!.textContent).toMatch(/overlap/i);
    // The rejected second block never committed — still exactly one block.
    expect(
      container.querySelectorAll('[aria-label="Remove block 1"]').length
    ).toBe(1);
    expect(
      container.querySelector('[aria-label="Remove block 2"]')
    ).toBeFalsy();
  });

  it("removing the only block reverts the day to Rest", () => {
    mount(<Harness initial={blocks} sports={["Bike"]} />);

    click(container.querySelector('[aria-label="Remove block 1"]'));
    expect(container.textContent).toContain("Rest — no time set for this day.");
  });

  it("selecting an energy level updates aria-pressed on the chips", () => {
    mount(<Harness initial={blocks} sports={["Bike"]} />);

    click(findButton("Full gas"));
    expect(findButton("Full gas")?.getAttribute("aria-pressed")).toBe("true");
    expect(findButton("Normal")?.getAttribute("aria-pressed")).toBe("false");
  });

  it("toggling a sport off then back on returns every chip to pressed", () => {
    mount(<Harness initial={blocks} sports={["Bike", "Run"]} />);

    // sports: null means every sport is currently enabled.
    expect(findButton("Bike")?.getAttribute("aria-pressed")).toBe("true");
    expect(findButton("Run")?.getAttribute("aria-pressed")).toBe("true");

    click(findButton("Bike"));
    expect(findButton("Bike")?.getAttribute("aria-pressed")).toBe("false");
    expect(findButton("Run")?.getAttribute("aria-pressed")).toBe("true");

    click(findButton("Bike"));
    expect(findButton("Bike")?.getAttribute("aria-pressed")).toBe("true");
    expect(findButton("Run")?.getAttribute("aria-pressed")).toBe("true");
  });

  it("tapping the backdrop calls onClose without calling onChange", () => {
    const onChange = vi.fn();
    const onClose = vi.fn();
    mount(
      <BlockSheet
        dayLabel="Wednesday"
        blocks={blocks}
        sports={["Bike"]}
        onChange={onChange}
        onClose={onClose}
      />
    );

    click(container.querySelector('button[aria-label="Close"]'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("tapping Done calls onClose", () => {
    const onClose = vi.fn();
    mount(
      <BlockSheet
        dayLabel="Wednesday"
        blocks={blocks}
        sports={["Bike"]}
        onChange={vi.fn()}
        onClose={onClose}
      />
    );

    click(findButton("Done"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
