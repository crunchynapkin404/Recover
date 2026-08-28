// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { AvailabilityTimeline } from "./availability-timeline";
import type { AvailabilityBlock } from "@/lib/availability/types";
import { toMins } from "@/lib/availability/timeline";

const block = (
  start: string,
  end: string,
  energy: AvailabilityBlock["energy"] = "normal"
): AvailabilityBlock => ({
  start,
  end,
  mins: toMins(end) - toMins(start),
  energy,
  sports: null,
});

const emptyWeek = (): AvailabilityBlock[][] =>
  Array.from({ length: 7 }, () => []);

function render(week: AvailabilityBlock[][], pinned = Array(7).fill(false)) {
  return renderToString(
    <AvailabilityTimeline
      week={week}
      pinned={pinned}
      onChangeDay={vi.fn()}
      onUnpin={vi.fn()}
      onOpenDay={vi.fn()}
    />
  );
}

describe("AvailabilityTimeline", () => {
  it("renders one track per weekday, Monday first", () => {
    const html = render(emptyWeek());
    for (const day of ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]) {
      expect(html).toContain(`>${day}<`);
    }
    expect(html.match(/data-track=/g)).toHaveLength(7);
  });

  // The spec's second named cost. A drag-only control is unusable by a screen
  // reader, so every block is a real button carrying the spec's own name.
  it("gives every block a focusable button with the spec's accessible name", () => {
    const week = emptyWeek();
    week[3] = [block("17:30", "19:45", "full")];
    const html = render(week);
    expect(html).toContain('aria-label="Thursday 17:30 to 19:45, full gas"');
    expect(html).toMatch(/<button[^>]*data-block="3:0"/);
  });

  it("paints energy as the measured density, not an invented hue", () => {
    const week = emptyWeek();
    week[0] = [block("06:00", "07:00", "easy")];
    week[1] = [block("06:00", "07:00", "normal")];
    week[2] = [block("06:00", "07:00", "full")];
    const html = render(week);
    expect(html).toContain("bg-accent/20");
    expect(html).toContain("bg-accent/40");
    expect(html).toContain("bg-accent/60");
  });

  // Decision 3's second channel: full gas is not told apart by density alone.
  it("marks full gas with the day strip's notch, and nothing below it", () => {
    const full = emptyWeek();
    full[0] = [block("06:00", "07:00", "full")];
    expect(render(full)).toContain('data-notch=""');
    const normal = emptyWeek();
    normal[0] = [block("06:00", "07:00", "normal")];
    expect(render(normal)).not.toContain("data-notch");
  });

  it("positions a pill by percentage of the track, not by pixels", () => {
    const week = emptyWeek();
    week[0] = [block("18:00", "21:00")];
    const html = render(week);
    // 05:00-23:00, so 18:00 is 13/18 along and the block is 3/18 wide.
    expect(html).toMatch(/left:\s*72\.2/);
    expect(html).toMatch(/width:\s*16\.6/);
  });

  it("says a day is rest when it has no blocks", () => {
    expect(render(emptyWeek())).toContain("Rest");
  });

  it("keeps the Pinned badge and its unpin affordance", () => {
    const pinned = Array(7).fill(false);
    pinned[2] = true;
    const html = render(emptyWeek(), pinned);
    expect(html).toContain("Pinned");
    expect(html).toContain('aria-label="Wednesday: back to your standard week"');
  });

  it("offers a plus per day that reaches the precise editor", () => {
    const html = render(emptyWeek());
    expect(html).toContain('aria-label="Add a block on Monday"');
    expect(html).toContain('aria-label="Edit Monday precisely"');
  });

  // Decision 2: an untimed legacy block has no position and must not be
  // given an invented one, but it must not vanish either.
  it("lists an untimed legacy block under its track rather than placing it", () => {
    const week = emptyWeek();
    week[0] = [
      { start: null, end: null, mins: 90, energy: "normal", sports: null },
    ];
    const html = render(week);
    expect(html).toContain("1h 30m");
    expect(html).toContain('data-untimed="0:0"');
    expect(html).not.toMatch(/data-block="0:0"/);
  });

  // The plan's global constraint: BlockSheet is position:fixed and nests
  // inside this sheet, so ANY transform on an ancestor collapses it.
  it("puts no transform on any ancestor of a nested dialog", () => {
    const week = emptyWeek();
    week[0] = [block("18:00", "19:00")];
    const html = render(week);
    // Both spellings: an inline `transform:` declaration and any Tailwind
    // utility that compiles to one. A lucide icon's own path data can contain
    // the word, so this checks the two shapes that actually create a
    // containing block, not the substring.
    expect(html).not.toMatch(/transform\s*:/);
    expect(html).not.toMatch(/class="[^"]*\b(translate|scale|rotate|skew)-/);
  });
});

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach } from "vitest";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

/** Mounts the timeline and returns the last `onChangeDay` call's arguments. */
function mount(week: AvailabilityBlock[][]) {
  const calls: [number, AvailabilityBlock[]][] = [];
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(
      <AvailabilityTimeline
        week={week}
        pinned={Array(7).fill(false)}
        onChangeDay={(d, next) => calls.push([d, next])}
        onUnpin={vi.fn()}
        onOpenDay={vi.fn()}
      />
    );
  });
  return {
    calls,
    press(id: string, key: string, shiftKey = false) {
      const el = host!.querySelector<HTMLElement>(`[data-block="${id}"]`);
      if (!el) throw new Error(`no block ${id}`);
      act(() => {
        el.dispatchEvent(
          new KeyboardEvent("keydown", { key, shiftKey, bubbles: true })
        );
      });
    },
  };
}

describe("AvailabilityTimeline keyboard path", () => {
  it("moves the start a quarter hour on ArrowRight", () => {
    const week = emptyWeek();
    week[0] = [block("18:00", "19:00")];
    const t = mount(week);
    t.press("0:0", "ArrowRight");
    expect(t.calls.at(-1)).toEqual([
      0,
      [expect.objectContaining({ start: "18:15", end: "19:15" })],
    ]);
  });

  it("moves the start back a quarter hour on ArrowLeft", () => {
    const week = emptyWeek();
    week[0] = [block("18:00", "19:00")];
    const t = mount(week);
    t.press("0:0", "ArrowLeft");
    expect(t.calls.at(-1)).toEqual([
      0,
      [expect.objectContaining({ start: "17:45", end: "18:45" })],
    ]);
  });

  it("resizes the end on shift+ArrowRight, keeping the start", () => {
    const week = emptyWeek();
    week[0] = [block("18:00", "19:00")];
    const t = mount(week);
    t.press("0:0", "ArrowRight", true);
    expect(t.calls.at(-1)).toEqual([
      0,
      [expect.objectContaining({ start: "18:00", end: "19:15", mins: 75 })],
    ]);
  });

  it("shrinks on shift+ArrowLeft but never below a quarter hour", () => {
    const week = emptyWeek();
    week[0] = [block("18:00", "18:15")];
    const t = mount(week);
    t.press("0:0", "ArrowLeft", true);
    expect(t.calls.at(-1)).toEqual([
      0,
      [expect.objectContaining({ start: "18:00", end: "18:15" })],
    ]);
  });

  it("opens the precise editor on Enter", () => {
    const week = emptyWeek();
    week[0] = [block("18:00", "19:00")];
    const opened: number[] = [];
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root!.render(
        <AvailabilityTimeline
          week={week}
          pinned={Array(7).fill(false)}
          onChangeDay={vi.fn()}
          onUnpin={vi.fn()}
          onOpenDay={(d) => opened.push(d)}
        />
      );
    });
    const el = host.querySelector<HTMLElement>('[data-block="0:0"]')!;
    act(() => {
      el.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true })
      );
    });
    expect(opened).toEqual([0]);
  });

  it("leaves other keys to the browser", () => {
    const week = emptyWeek();
    week[0] = [block("18:00", "19:00")];
    const t = mount(week);
    t.press("0:0", "Tab");
    t.press("0:0", "a");
    expect(t.calls).toHaveLength(0);
  });
});

describe("AvailabilityTimeline pointer drag", () => {
  /** jsdom gives every element a zero rect; the drag math needs a real width. */
  const realRect = HTMLElement.prototype.getBoundingClientRect;
  function stubTrackWidth(px: number) {
    Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
      configurable: true,
      value() {
        return { width: px, height: 36, top: 0, left: 0, right: px, bottom: 36, x: 0, y: 0, toJSON: () => ({}) };
      },
    });
  }
  // Restored, because this patches a PROTOTYPE: left in place it would hand a
  // fake 180px rect to every test that runs after this describe block, in
  // this file and — if the ordering ever changes — before the ones that
  // assert against real zero-width jsdom layout.
  afterEach(() => {
    Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
      configurable: true,
      value: realRect,
    });
  });

  function drag(el: HTMLElement, fromX: number, toX: number) {
    (el as HTMLElement & { setPointerCapture?: (id: number) => void }).setPointerCapture =
      () => {};
    (el as HTMLElement & { releasePointerCapture?: (id: number) => void }).releasePointerCapture =
      () => {};
    act(() => {
      el.dispatchEvent(
        new PointerEvent("pointerdown", { clientX: fromX, pointerId: 1, bubbles: true })
      );
    });
    act(() => {
      el.dispatchEvent(
        new PointerEvent("pointermove", { clientX: toX, pointerId: 1, bubbles: true })
      );
    });
    act(() => {
      el.dispatchEvent(
        new PointerEvent("pointerup", { clientX: toX, pointerId: 1, bubbles: true })
      );
    });
  }

  it("moves a block by the dragged distance, snapped", () => {
    stubTrackWidth(180); // 18h over 180px — 10px an hour, so 30px is 3h.
    const week = emptyWeek();
    week[0] = [block("10:00", "11:00")];
    const t = mount(week);
    drag(host!.querySelector<HTMLElement>('[data-block="0:0"]')!, 0, 30);
    expect(t.calls.at(-1)).toEqual([
      0,
      [expect.objectContaining({ start: "13:00", end: "14:00" })],
    ]);
  });

  it("resizes from the end handle instead of moving", () => {
    stubTrackWidth(180);
    const week = emptyWeek();
    week[0] = [block("10:00", "11:00")];
    const t = mount(week);
    act(() => {
      host!
        .querySelector<HTMLElement>('[data-block="0:0"]')!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    drag(host!.querySelector<HTMLElement>('[data-handle="0:0:end"]')!, 0, 10);
    expect(t.calls.at(-1)).toEqual([
      0,
      [expect.objectContaining({ start: "10:00", end: "12:00", mins: 120 })],
    ]);
  });

  // The spec: handles appear only on the selected block, and OUTSIDE the
  // pill's visual bounds so the touch target is not the pill's own width.
  it("shows resize handles only on the selected block", () => {
    stubTrackWidth(180);
    const week = emptyWeek();
    week[0] = [block("10:00", "11:00")];
    mount(week);
    expect(host!.querySelector('[data-handle="0:0:end"]')).toBeNull();
    act(() => {
      host!
        .querySelector<HTMLElement>('[data-block="0:0"]')!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(host!.querySelector('[data-handle="0:0:end"]')).not.toBeNull();
    expect(host!.querySelector('[data-handle="0:0:start"]')).not.toBeNull();
  });

  it("commits nothing when the pointer never moved", () => {
    stubTrackWidth(180);
    const week = emptyWeek();
    week[0] = [block("10:00", "11:00")];
    const t = mount(week);
    drag(host!.querySelector<HTMLElement>('[data-block="0:0"]')!, 40, 40);
    expect(t.calls).toHaveLength(0);
  });
});
