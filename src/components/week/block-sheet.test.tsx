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

/** The `class` attribute of the first `<tag>` in `html` whose sole text content is `label`. */
function classFor(html: string, tag: string, label: string): string {
  const match = html.match(
    new RegExp(`<${tag}[^>]*class="([^"]*)"[^>]*>${label}<`)
  );
  if (!match) throw new Error(`no <${tag}> found containing "${label}"`);
  return match[1];
}

/** The `class` attribute of the first `<li>` — the nested block tile. */
function tileClass(html: string): string {
  const match = html.match(/<li[^>]*class="([^"]*)"/);
  if (!match) throw new Error("no <li> tile found");
  return match[1];
}

/** The bg-* / border-* utilities in a class string, as a set — the fill and outline cues, not text colour. */
function fillTokens(classAttr: string): Set<string> {
  return new Set(classAttr.split(/\s+/).filter((c) => /^(bg|border)-/.test(c)));
}

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

  it("gives the selected energy chip a fill that neither the unselected chip nor the tile behind it share", () => {
    // Pins the actual defect, not just the presence of a style: a selected
    // chip painted the same as the tile it sits on, or the same as its own
    // unselected sibling, is invisible as "selected" no matter how many
    // classes are attached to it.
    const html = renderToString(
      <BlockSheet
        dayLabel="Wednesday"
        blocks={blocks}
        sports={["Bike"]}
        onChange={vi.fn()}
        onClose={vi.fn()}
      />
    );

    const tileFill = [...fillTokens(tileClass(html))].filter((c) =>
      c.startsWith("bg-")
    );
    const activeFill = fillTokens(classFor(html, "button", "Normal"));
    const inactiveFill = fillTokens(classFor(html, "button", "Easy"));
    const activeBg = [...activeFill].filter((c) => c.startsWith("bg-"));

    // The unselected chip must declare its own background rather than
    // leaving a transparent hole the tile's fill shows through.
    expect(
      inactiveFill.size > 0 &&
        [...inactiveFill].some((c) => c.startsWith("bg-"))
    ).toBe(true);
    // The selected chip's own fill must not be the same token as the tile
    // sitting behind it — that collision is exactly what erased the cue.
    expect(activeBg.some((c) => tileFill.includes(c))).toBe(false);
    // And, directly: selected and unselected must not present the same
    // fill/border utilities as each other.
    expect(activeFill).not.toEqual(inactiveFill);
  });

  it("uses the token scale, not ad-hoc sizes or white alphas", () => {
    const html = renderToString(
      <BlockSheet
        dayLabel="Wednesday"
        blocks={blocks}
        sports={["Bike", "Run"]}
        onChange={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(html).not.toMatch(/text-\[[\d.]+px\]/);
    expect(html).not.toMatch(/\btext-(xs|sm)\b/);
    expect(html).not.toMatch(/text-white\//);
    expect(html).not.toMatch(/bg-white\//);
    expect(html).not.toMatch(/border-white\//);
  });

  it("stays on glass — it is floating chrome, not page flow", () => {
    const html = renderToString(
      <BlockSheet
        dayLabel="Wednesday"
        blocks={blocks}
        sports={["Bike"]}
        onChange={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(html).toContain("glass");
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

  function setTime(el: Element | null | undefined, value: string) {
    expect(el).toBeTruthy();
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )!.set!;
    act(() => {
      setter.call(el, value);
      el!.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  // A legacy "duration-only" block — start/end null, duration carried by
  // `mins` alone. Rows migrated from the pre-block model look like this.
  //
  // 90 minutes, deliberately NOT 60: the "Add a block" default is 60, so a
  // fixture of 60 cannot tell a genuine read of the block's stored duration
  // apart from a hardcoded default. Verified by mutation — swapping `b.mins`
  // for a literal 60 passes against a 60-minute fixture and fails against
  // this one.
  const legacyBlock: AvailabilityBlock[] = [
    { start: null, end: null, mins: 90, energy: "normal", sports: null },
  ];

  it("giving a legacy duration-only block a start time keeps its duration", () => {
    // The bug this pins: validateBlocks legally admits only both-null or
    // both-set, and every edit commits immediately — so setting just the
    // start of a null/null block lands on the illegal half-set shape, the
    // commit is rejected, and the input reverts. There was no path at all
    // from a legacy block to a clock range through this UI.
    // The stored 90 minutes is what decides the other end: 18:00 -> 19:30.
    mount(<Harness initial={legacyBlock} sports={["Bike"]} />);

    setTime(
      container.querySelector('[aria-label="Block 1 start time"]'),
      "18:00"
    );

    expect(container.querySelector('[role="alert"]')).toBeFalsy();
    expect(
      container.querySelector<HTMLInputElement>(
        '[aria-label="Block 1 start time"]'
      )!.value
    ).toBe("18:00");
    expect(
      container.querySelector<HTMLInputElement>(
        '[aria-label="Block 1 end time"]'
      )!.value
    ).toBe("19:30");
  });

  it("giving a legacy duration-only block an end time keeps its duration", () => {
    // The mirror case: the end field must work the same way, deriving the
    // start backwards from the stored duration. 19:00 - 90min -> 17:30.
    mount(<Harness initial={legacyBlock} sports={["Bike"]} />);

    setTime(
      container.querySelector('[aria-label="Block 1 end time"]'),
      "19:00"
    );

    expect(container.querySelector('[role="alert"]')).toBeFalsy();
    expect(
      container.querySelector<HTMLInputElement>(
        '[aria-label="Block 1 start time"]'
      )!.value
    ).toBe("17:30");
    expect(
      container.querySelector<HTMLInputElement>(
        '[aria-label="Block 1 end time"]'
      )!.value
    ).toBe("19:00");
  });

  it("clamps a derived end to the last minute of the day", () => {
    // 23:30 + 90min would run past midnight, which TIME_RE rejects and which
    // a single day's block cannot express. The derived end clamps to 23:59
    // and the duration follows it down to 29min, rather than the edit being
    // refused outright.
    mount(<Harness initial={legacyBlock} sports={["Bike"]} />);

    setTime(
      container.querySelector('[aria-label="Block 1 start time"]'),
      "23:30"
    );

    expect(container.querySelector('[role="alert"]')).toBeFalsy();
    expect(
      container.querySelector<HTMLInputElement>(
        '[aria-label="Block 1 end time"]'
      )!.value
    ).toBe("23:59");
    expect(container.textContent).toContain("29m");
  });

  it("does not derive anything from a cleared time field", () => {
    // A type="time" input reports a partially entered or cleared value as
    // "", which parses to NaN. Deriving from it would write a literal
    // "NaN:NaN" into the block; instead nothing is derived and the existing
    // shape validation says what is wrong.
    mount(<Harness initial={legacyBlock} sports={["Bike"]} />);

    setTime(container.querySelector('[aria-label="Block 1 start time"]'), "");

    expect(container.textContent).not.toContain("NaN");
    expect(
      container.querySelector<HTMLInputElement>(
        '[aria-label="Block 1 end time"]'
      )!.value
    ).toBe("");
  });

  it("editing one end of an already-timed block does not re-derive the other", () => {
    // Guards the fix from overreaching: derivation is ONLY for the legacy
    // null/null case. On a normal 18:00-19:30 block, moving the end to 20:00
    // must leave the start alone and let mins follow, not drag the start
    // forward to preserve 90 minutes.
    mount(<Harness initial={blocks} sports={["Bike"]} />);

    setTime(
      container.querySelector('[aria-label="Block 1 end time"]'),
      "20:00"
    );

    expect(container.querySelector('[role="alert"]')).toBeFalsy();
    expect(
      container.querySelector<HTMLInputElement>(
        '[aria-label="Block 1 start time"]'
      )!.value
    ).toBe("18:00");
    expect(container.textContent).toContain("2h");
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
