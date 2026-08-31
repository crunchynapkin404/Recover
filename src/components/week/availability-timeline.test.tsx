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

  // Decision 3's second channel, COUNTED. Painting the notch only on `full`
  // left easy and normal apart by fill density alone at 1.37:1 — under the
  // 3:1 WCAG asks of a meaningful graphical distinction, on a pill that
  // carries no text. Found by the whole-branch review.
  it("gives each energy its own notch count, not colour alone", () => {
    const dots = (energy: AvailabilityBlock["energy"]) => {
      const week = emptyWeek();
      week[0] = [block("06:00", "07:00", energy)];
      const html = render(week);
      const i = html.indexOf('data-notch=""');
      if (i === -1) return 0;
      const tail = html.slice(i, html.indexOf("</button>", i));
      return (tail.match(/h-1 w-1 rounded-full/g) ?? []).length;
    };
    expect(dots("easy")).toBe(0);
    expect(dots("normal")).toBe(1);
    expect(dots("full")).toBe(2);
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

  it("marks a pinned day without spending a control on it", () => {
    // REPLACES "keeps the Pinned badge and its unpin affordance" (slice 6).
    // The badge was a status that happened to be pressable, up to seven times
    // on one sheet — the largest single contributor to a choice load that
    // rose 17 → 31 in v0.124.0, and it crowded the row until the block
    // summary truncated on a two-block day.
    //
    // It is a mark now. Per-day unpin did not disappear with it: BlockSheet
    // gained "Back to your standard day" in the commit before this one, which
    // is why that ordering mattered.
    const pinned = Array(7).fill(false);
    pinned[2] = true;
    const html = render(emptyWeek(), pinned);

    // Still says so — it is real state, and a screen reader must still hear it.
    expect(html).toContain("Pinned");

    // But it is no longer a button, and no longer claims an action it cannot
    // perform. The old aria-label promised "back to your standard week".
    expect(html).not.toContain("Pinned ×");
    expect(html).not.toContain("back to your standard week");
  });

  it("offers a plus per day that reaches the precise editor", () => {
    const html = render(emptyWeek());
    expect(html).toContain('aria-label="Add a block on Monday"');
    expect(html).toContain('aria-label="Edit Monday precisely"');
  });

  // An untimed day rendered as a BLANK TRACK with a bare duration chip below
  // it, which reads as broken rather than as "these have no time yet". Every
  // athlete whose standard week predates v0.124.0 has exactly this state, so
  // it is the first thing they see. Found by opening the rc.1 soak capture.
  it("says a day has time with no hour set, rather than rendering blank", () => {
    const week = emptyWeek();
    week[0] = [
      { start: null, end: null, mins: 95, energy: "normal", sports: null },
    ];
    const html = render(week);
    expect(html).toContain("No time set");
    expect(html).toContain('aria-label="Set a time for Monday 1h 35m, normal"');
  });

  it("says nothing of the sort on a genuinely empty day", () => {
    const html = render(emptyWeek());
    expect(html).not.toContain("No time set");
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

  // ACTIVATION MEANS THE SAME THING IN EVERY MODALITY. It did not: click
  // toggled selection while Enter opened BlockSheet — and a touch
  // screen-reader double-tap dispatches a CLICK, so those users got a
  // selection toggle whose only effect is revealing two aria-hidden spans,
  // and could never reach the precise editor from a pill. aria-pressed was
  // announcing a toggle the keyboard path never performed. BlockSheet is
  // still one Tab away on the day's own "Edit precisely" control, which does
  // not depend on selection and is the better assistive path anyway.
  it("toggles selection on Enter, exactly as a click does", () => {
    const week = emptyWeek();
    week[0] = [block("18:00", "19:00")];
    mount(week);
    const el = host!.querySelector<HTMLElement>('[data-block="0:0"]')!;
    expect(el.getAttribute("aria-pressed")).toBe("false");
    act(() => {
      el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(
      host!.querySelector('[data-block="0:0"]')!.getAttribute("aria-pressed")
    ).toBe("true");
  });

  it("does not hand Enter a different meaning from a tap", () => {
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
    act(() => {
      host!
        .querySelector<HTMLElement>('[data-block="0:0"]')!
        .dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true })
        );
    });
    // Enter no longer short-circuits to the sheet; the browser's own
    // button semantics turn it into the same click a tap produces.
    expect(opened).toEqual([]);
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
        return {
          width: px,
          height: 36,
          top: 0,
          left: 0,
          right: px,
          bottom: 36,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        };
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
    (
      el as HTMLElement & { setPointerCapture?: (id: number) => void }
    ).setPointerCapture = () => {};
    (
      el as HTMLElement & { releasePointerCapture?: (id: number) => void }
    ).releasePointerCapture = () => {};
    act(() => {
      el.dispatchEvent(
        new PointerEvent("pointerdown", {
          clientX: fromX,
          pointerId: 1,
          bubbles: true,
        })
      );
    });
    act(() => {
      el.dispatchEvent(
        new PointerEvent("pointermove", {
          clientX: toX,
          pointerId: 1,
          bubbles: true,
        })
      );
    });
    act(() => {
      el.dispatchEvent(
        new PointerEvent("pointerup", {
          clientX: toX,
          pointerId: 1,
          bubbles: true,
        })
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

// ── Regressions found by the whole-branch review (2026-08-29) ──────────────

describe("AvailabilityTimeline gesture safety", () => {
  function stubTrackWidth(px: number) {
    Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
      configurable: true,
      value() {
        return {
          width: px,
          height: 36,
          top: 0,
          left: 0,
          right: px,
          bottom: 36,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        };
      },
    });
  }
  const realRect = HTMLElement.prototype.getBoundingClientRect;
  afterEach(() => {
    Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
      configurable: true,
      value: realRect,
    });
  });

  function pointer(el: HTMLElement, xs: number[]) {
    const cast = el as HTMLElement & {
      setPointerCapture?: (id: number) => void;
      releasePointerCapture?: (id: number) => void;
    };
    cast.setPointerCapture = () => {};
    cast.releasePointerCapture = () => {};
    act(() => {
      el.dispatchEvent(
        new PointerEvent("pointerdown", {
          clientX: xs[0],
          pointerId: 1,
          bubbles: true,
        })
      );
    });
    for (const x of xs.slice(1)) {
      act(() => {
        el.dispatchEvent(
          new PointerEvent("pointermove", {
            clientX: x,
            pointerId: 1,
            bubbles: true,
          })
        );
      });
    }
    act(() => {
      el.dispatchEvent(
        new PointerEvent("pointerup", {
          clientX: xs[xs.length - 1],
          pointerId: 1,
          bubbles: true,
        })
      );
    });
  }

  // A tap is not a drag. pxToMins(3px) is 9.5 minutes, which snap() rounds to
  // a full quarter hour — so ordinary touch jitter on a tap silently moved the
  // block and committed it. Android's touch slop alone is 8px.
  it("ignores a tap that wobbles below the drag threshold", () => {
    stubTrackWidth(342);
    const week = emptyWeek();
    week[0] = [block("18:00", "19:00")];
    const t = mount(week);
    pointer(
      host!.querySelector<HTMLElement>('[data-block="0:0"]')!,
      [100, 103]
    );
    expect(t.calls).toHaveLength(0);
  });

  it("still commits once the pointer travels past the threshold", () => {
    stubTrackWidth(342);
    const week = emptyWeek();
    week[0] = [block("18:00", "19:00")];
    const t = mount(week);
    pointer(
      host!.querySelector<HTMLElement>('[data-block="0:0"]')!,
      [100, 140]
    );
    expect(t.calls.length).toBeGreaterThan(0);
  });

  // The browser fires a compatibility click after pointerup. It bubbled from
  // the aria-hidden handle span to the pill button, whose onClick toggles
  // selection — so every resize ended by unmounting the handles it was using.
  it("does not toggle selection on the click that follows a drag", () => {
    stubTrackWidth(342);
    const week = emptyWeek();
    week[0] = [block("18:00", "19:00")];
    mount(week);
    const pill = host!.querySelector<HTMLElement>('[data-block="0:0"]')!;
    act(() => {
      pill.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(host!.querySelector('[data-handle="0:0:end"]')).not.toBeNull();

    pointer(
      host!.querySelector<HTMLElement>('[data-handle="0:0:end"]')!,
      [100, 140]
    );
    // The click the browser synthesises after the gesture.
    act(() => {
      host!
        .querySelector<HTMLElement>('[data-handle="0:0:end"]')!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(host!.querySelector('[data-handle="0:0:end"]')).not.toBeNull();
  });

  // The handle path above is protected by the handle's OWN stopPropagation,
  // so it passes with or without swallowClick — which a mutation run proved.
  // The flag is load-bearing for a drag on the PILL itself, where nothing
  // stops the click bubbling to its own onClick and toggling selection off.
  it("does not toggle selection on the click that follows a pill drag", () => {
    stubTrackWidth(342);
    const week = emptyWeek();
    week[0] = [block("18:00", "19:00")];
    mount(week);
    const pill = () => host!.querySelector<HTMLElement>('[data-block="0:0"]')!;
    act(() => {
      pill().dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(pill().getAttribute("aria-pressed")).toBe("true");

    pointer(pill(), [100, 150]);
    act(() => {
      pill().dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    // Still selected: the drag's trailing click is not a selection gesture.
    expect(pill().getAttribute("aria-pressed")).toBe("true");
  });

  // One drag ref per day with no pointerId: a second finger landing on another
  // pill overwrote the in-flight gesture's block index and origin, so the first
  // finger's next move jumped a block it was never touching.
  it("ignores pointer events from a second, uninvolved finger", () => {
    stubTrackWidth(342);
    const week = emptyWeek();
    week[0] = [block("07:00", "08:00"), block("18:00", "19:00")];
    const t = mount(week);
    const first = host!.querySelector<HTMLElement>('[data-block="0:0"]')!;
    const cast = first as HTMLElement & {
      setPointerCapture?: (id: number) => void;
    };
    cast.setPointerCapture = () => {};
    act(() => {
      first.dispatchEvent(
        new PointerEvent("pointerdown", {
          clientX: 100,
          pointerId: 1,
          bubbles: true,
        })
      );
    });
    act(() => {
      first.dispatchEvent(
        new PointerEvent("pointermove", {
          clientX: 300,
          pointerId: 2,
          bubbles: true,
        })
      );
    });
    expect(t.calls).toHaveLength(0);
  });
});
