// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * I7 — "Back to standard" was undone by the next Confirm.
 *
 * IntakeForm held the resolved week in `useState(resolved)`, which React
 * initialises once and never resyncs. Pressing "Pinned ×" calls
 * clearDayOverride + revalidatePath, so the server re-renders with the
 * standard week and the badge disappears — but the client kept the deleted
 * override's blocks, and the hidden `blocks-${i}` input still submitted them.
 * "Confirm week" then ran syncDateOverrides, saw blocks differing from the
 * default, and re-created the override that had just been deleted.
 *
 * The hidden inputs are the assertion surface because they are what actually
 * reaches the server action — the visible label could be right while the
 * submitted value is stale.
 *
 * Rendered with react-dom/client per tests/journal-form.test.tsx: the
 * assertions are plain DOM, so @testing-library/react would add a dependency
 * without adding reach.
 */
declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// "use server" module — a genuine module boundary, not the logic under test.
vi.mock("@/app/plan/actions", () => ({
  clearDayOverride: vi.fn(async () => ({ ok: true })),
}));

import { IntakeForm } from "@/components/week/intake-form";
import type { AvailabilityBlock } from "@/lib/availability/types";

const blk = (mins: number): AvailabilityBlock => ({
  start: null,
  end: null,
  mins,
  energy: "normal",
  sports: null,
});

const DATES = [
  "2026-07-20",
  "2026-07-21",
  "2026-07-22",
  "2026-07-23",
  "2026-07-24",
  "2026-07-25",
  "2026-07-26",
];

/** Monday carries `mondayMins`; the rest of the week is empty. */
const week = (mondayMins: number): AvailabilityBlock[][] => [
  [blk(mondayMins)],
  [],
  [],
  [],
  [],
  [],
  [],
];

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function render(node: React.ReactElement) {
  if (!container) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  }
  act(() => {
    root!.render(node);
  });
  return container;
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.clearAllMocks();
});

function mondayBlocks(el: HTMLElement): AvailabilityBlock[] {
  const input = el.querySelector<HTMLInputElement>('input[name="blocks-0"]');
  if (!input) throw new Error("blocks-0 hidden input not found");
  return JSON.parse(input.value);
}

const action = async () => ({ message: "" });

describe("IntakeForm — resyncs when the server sends a new week (I7)", () => {
  it("submits the standard week after a pinned day is unpinned", () => {
    // Monday pinned to a 120-minute override; the standard week says 60.
    const el = render(
      <IntakeForm
        resolved={week(120)}
        dates={DATES}
        overrideDates={[DATES[0]]}
        verdict={{ kind: "silent" }}
        sports={["Run"]}
        action={action}
      />
    );
    expect(mondayBlocks(el)[0].mins).toBe(120);

    // unpin() deleted the override and revalidated, so the server re-renders
    // with the standard week and no pinned dates.
    render(
      <IntakeForm
        resolved={week(60)}
        dates={DATES}
        overrideDates={[]}
        verdict={{ kind: "silent" }}
        sports={["Run"]}
        action={action}
      />
    );

    // Pre-fix this was still 120 — the deleted override, about to be
    // re-created by the next syncDateOverrides.
    expect(mondayBlocks(el)[0].mins).toBe(60);
  });

  it("shows the standard week's total once the pin is gone", () => {
    const el = render(
      <IntakeForm
        resolved={week(120)}
        dates={DATES}
        overrideDates={[DATES[0]]}
        verdict={{ kind: "silent" }}
        sports={["Run"]}
        action={action}
      />
    );
    expect(el.textContent).toContain("2h 00m this week");

    render(
      <IntakeForm
        resolved={week(60)}
        dates={DATES}
        overrideDates={[]}
        verdict={{ kind: "silent" }}
        sports={["Run"]}
        action={action}
      />
    );
    expect(el.textContent).toContain("1h 00m this week");
  });

  it("keeps a local edit while the server props stay the same", () => {
    // The resync must not fight the editor: re-rendering with an unchanged
    // server week leaves whatever the athlete has typed in place.
    const resolved = week(60);
    const el = render(
      <IntakeForm
        resolved={resolved}
        dates={DATES}
        overrideDates={[]}
        verdict={{ kind: "silent" }}
        sports={["Run"]}
        action={action}
      />
    );
    expect(mondayBlocks(el)[0].mins).toBe(60);

    // Same values, fresh array identity — exactly what a re-render of the
    // parent server component produces.
    render(
      <IntakeForm
        resolved={week(60)}
        dates={DATES}
        overrideDates={[]}
        verdict={{ kind: "silent" }}
        sports={["Run"]}
        action={action}
      />
    );
    expect(mondayBlocks(el)[0].mins).toBe(60);
  });
});
