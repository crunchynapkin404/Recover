// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// `IntakeForm` (rendered for real here, not a stand-in) reaches straight into
// this "use server" module for `clearDayOverride`. Stubbed the same way
// races-section-demand.test.tsx stubs @/app/plan/actions — the write path
// has its own DB coverage; what we need here is the ARGUMENT it's called
// with.
vi.mock("@/app/plan/actions", () => ({
  clearDayOverride: vi.fn(async () => ({ ok: true })),
}));

import {
  AvailabilityWeekSwitcher,
  type AvailabilityWeekSwitcherProps,
  type WeekIntake,
} from "./availability-week-switcher";
import type { IntakeState } from "@/components/week/intake-form";
import { clearDayOverride } from "@/app/plan/actions";

const clearDayOverrideMock = vi.mocked(clearDayOverride);

const NEXT_MONDAY = "2026-08-03";
const THIS_DATES = [
  "2026-07-27",
  "2026-07-28",
  "2026-07-29",
  "2026-07-30",
  "2026-07-31",
  "2026-08-01",
  "2026-08-02",
];
const NEXT_DATES = [
  "2026-08-03",
  "2026-08-04",
  "2026-08-05",
  "2026-08-06",
  "2026-08-07",
  "2026-08-08",
  "2026-08-09",
];

// This week's Monday starts empty ("Rest") so the "survives toggling" test
// has an unambiguous before/after. Next week's Tuesday carries a real block
// so the "shows next week's own data" test has something to distinguish it
// from this week's. Next week's Wednesday is pinned (an override) so there
// is exactly one "Pinned ×" badge in the whole tree, unambiguously
// belonging to next week.
const thisWeek: WeekIntake = {
  resolved: THIS_DATES.map(() => []),
  dates: THIS_DATES,
  overrideDates: [],
  verdict: { kind: "ok" },
  weekStart: "",
  offeredMins: 0,
};

const nextWeek: WeekIntake = {
  resolved: NEXT_DATES.map((_, i) =>
    i === 1
      ? [
          {
            start: "07:00",
            end: "08:00",
            mins: 60,
            energy: "normal" as const,
            sports: null,
          },
        ]
      : []
  ),
  dates: NEXT_DATES,
  overrideDates: [NEXT_DATES[2]],
  verdict: { kind: "ok" },
  weekStart: NEXT_MONDAY,
  offeredMins: 60,
};

let root: Root | null = null;
let container: HTMLDivElement;

async function render(initialMode?: "this" | "next") {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const action = vi.fn(async (): Promise<IntakeState> => ({
    message: "",
  }));
  await act(async () => {
    root!.render(
      <AvailabilityWeekSwitcher
        thisWeek={thisWeek}
        nextWeek={nextWeek}
        initialMode={initialMode}
        sports={["Bike"]}
        action={action}
      />
    );
  });
}

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
  container?.remove();
  vi.clearAllMocks();
});

function formByHeading(text: string): HTMLFormElement {
  const form = Array.from(container.querySelectorAll("form")).find((f) =>
    f.textContent?.includes(text)
  );
  if (!form) throw new Error(`no form with heading containing "${text}"`);
  return form;
}

function thisForm(): HTMLFormElement {
  return formByHeading("This week's availability");
}

function nextForm(): HTMLFormElement {
  return formByHeading("Next week's availability");
}

function weekStartOf(form: HTMLFormElement): string {
  const el = form.querySelector<HTMLInputElement>('input[name="weekStart"]');
  if (!el) throw new Error("no weekStart hidden input");
  return el.value;
}

/** The `hidden` attribute lives on the wrapping div, not the form itself. */
function isHidden(form: HTMLFormElement): boolean {
  return form.closest("[hidden]") != null;
}

async function click(text: string) {
  const btn = Array.from(container.querySelectorAll("button")).find((b) =>
    b.textContent?.includes(text)
  );
  if (!btn) throw new Error(`no button containing "${text}"`);
  await act(async () => {
    btn.click();
  });
}

/** Same button-in-a-scoped-root pattern as `click`, but scoped to one form. */
async function clickWithin(form: HTMLFormElement, text: string) {
  const btn = Array.from(form.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === text
  );
  if (!btn) throw new Error(`no button with text "${text}" in that form`);
  await act(async () => {
    btn.click();
  });
}

describe("AvailabilityWeekSwitcher", () => {
  it("defaults to this week: weekStart empty, this-week form visible", async () => {
    await render();
    expect(weekStartOf(thisForm())).toBe("");
    expect(isHidden(thisForm())).toBe(false);
    expect(isHidden(nextForm())).toBe(true);
  });

  it("sets weekStart to next Monday and shows next-week's form when toggled", async () => {
    await render();
    await click("Next week");
    expect(weekStartOf(nextForm())).toBe(NEXT_MONDAY);
    expect(isHidden(nextForm())).toBe(false);
    expect(isHidden(thisForm())).toBe(true);
  });

  it("clears weekStart back to empty when toggled back to This week", async () => {
    await render();
    await click("Next week");
    await click("This week");
    expect(weekStartOf(thisForm())).toBe("");
    expect(isHidden(thisForm())).toBe(false);
    expect(isHidden(nextForm())).toBe(true);
  });

  it("starts in next-week mode directly when ?availability=next drives initialMode", async () => {
    await render("next");
    expect(weekStartOf(nextForm())).toBe(NEXT_MONDAY);
    expect(isHidden(nextForm())).toBe(false);
    expect(isHidden(thisForm())).toBe(true);
  });

  it("renders next week's own blocks, not this week's, in next-week mode", async () => {
    await render();
    await click("Next week");
    // Next week's Tuesday block — proves the form is showing a real
    // projection of next week, not this week's (empty) data relabelled.
    expect(nextForm().textContent).toContain("07:00–08:00");
    // This week has no blocks at all (every day is "Rest"); if next week's
    // form were actually showing this week's data it would say so here.
    expect(nextForm().textContent).not.toContain("18:00");
  });

  it("targets a next-week date when unpinning in next-week mode", async () => {
    await render();
    await click("Next week");

    const unpinBtn = Array.from(nextForm().querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Pinned")
    );
    if (!unpinBtn) throw new Error('no "Pinned ×" button on next week\'s form');
    await act(async () => {
      unpinBtn.click();
    });

    expect(clearDayOverrideMock).toHaveBeenCalledTimes(1);
    // The critical assertion: the date passed is one of NEXT week's dates
    // (specifically the pinned one, NEXT_DATES[2]) — not the corresponding
    // THIS-week date. Before the fix, `dates` handed to next-week mode was
    // always this week's, so this would have been THIS_DATES[2] instead.
    expect(clearDayOverrideMock).toHaveBeenCalledWith(NEXT_DATES[2]);
  });

  it("does not have a 'Pinned ×' button anywhere for this week (no overrides there)", async () => {
    await render();
    const pinnedButtons = Array.from(
      thisForm().querySelectorAll("button")
    ).filter((b) => b.textContent?.includes("Pinned"));
    expect(pinnedButtons).toHaveLength(0);
  });

  it("keeps an edit typed for one week when toggling away and back", async () => {
    await render();

    // This week's Monday starts as "Rest". Open its block editor and add a
    // block — a real edit made through the actual IntakeForm + BlockSheet
    // component tree, not a stand-in.
    const monBtn = Array.from(thisForm().querySelectorAll("button")).find(
      (b) =>
        // Slice 3: the day list became AvailabilityTimeline, so a day is
        // opened from its own "edit precisely" control rather than by
        // tapping a row. Same behaviour under test, new affordance.
        b.getAttribute("aria-label") === "Edit Monday precisely"
    );
    if (!monBtn) throw new Error("no Monday row in this week's form");
    await act(async () => {
      monBtn.click();
    });

    await clickWithin(thisForm(), "Add a block");
    // Close the sheet (BlockSheet's "Done" button) so the day row's summary
    // text is what we assert against below.
    await clickWithin(thisForm(), "Done");

    expect(thisForm().textContent).toContain("18:00–19:00");

    // Toggle away to next week and back. Because both IntakeForm instances
    // stay mounted throughout (see the component's docstring on why), this
    // must not have touched this week's local edit at all.
    await click("Next week");
    await click("This week");

    expect(thisForm().textContent).toContain("18:00–19:00");
  });

  // Compile-time-only proof that nothing but `action` may be function-
  // valued on this component's props — the exact shape of Critical finding
  // 1 (a render-prop `children` closure cannot cross the Server->Client
  // boundary). This is enforced by `npm run typecheck`, NOT by `vitest run`
  // itself: vitest transpiles this file with esbuild, which strips types
  // without checking them, so a real violation here would still pass at
  // runtime — only `tsc --noEmit` (part of the five-command gate) would
  // catch it. Recorded here anyway so the intent is pinned to the test
  // suite, not just to a comment.
  type AnyTrue<U> = Extract<U, true> extends never ? false : true;
  type HasFunction<T> = T extends (...args: never[]) => unknown
    ? true
    : T extends readonly (infer U)[]
      ? HasFunction<U>
      : T extends object
        ? AnyTrue<HasFunction<T[keyof T]>>
        : false;
  type NonActionProps = Omit<AvailabilityWeekSwitcherProps, "action">;
  // If a future edit made any of `thisWeek` / `nextWeek` / `sports` /
  // `initialMode` (or anything nested inside them) function-valued, this
  // resolves to `never` and the assignment below fails to typecheck.
  type NoStrayFunctions =
    HasFunction<NonActionProps> extends false ? true : never;

  it("passes no function-valued props into the client switcher except the server action", () => {
    const proof: NoStrayFunctions = true;
    expect(proof).toBe(true);
  });

  // The chip trap (Task 7 shipped it once): a selection control's active
  // segment must differ from its inactive segment in FILL, not text colour
  // alone. This now renders only inside the "availability" sheet (slice 2
  // task 4), whose own panel is bg-surface-overlay — the toggle used to sit
  // directly on that panel with its OWN `bg-surface-overlay` on the active
  // pill (identical to the panel, in both themes) and `bg-surface-raised`
  // on the inactive one (identical to the panel in light only). Wrapped in
  // a `border-hairline bg-surface-selected` capsule, the same shape
  // PlanStyleSwitch/SeasonModeSwitch use for this exact "separate pills
  // inside an overlay sheet" case, with the active segment's own
  // `bg-surface-overlay` now read against that capsule instead of directly
  // against the sheet.
  it("gives the active segment a fill the inactive segment does not have, on a capsule distinct from the sheet", async () => {
    await render();
    const group = container.querySelector(
      '[role="group"][aria-label="Availability week"]'
    );
    expect(group).not.toBeNull();
    expect(group!.className).toContain("bg-surface-selected");
    expect(group!.className).not.toContain("bg-surface-raised");

    const buttons = Array.from(group!.querySelectorAll("button"));
    const active = buttons.find((b) => b.textContent === "This week");
    const inactive = buttons.find((b) => b.textContent === "Next week");
    expect(active).toBeDefined();
    expect(inactive).toBeDefined();
    expect(active!.className).toContain("bg-surface-overlay");
    expect(inactive!.className).not.toContain("bg-surface-overlay");
    expect(inactive!.className).not.toContain("bg-surface-raised");
    expect(active!.className).not.toBe(inactive!.className);
  });

  it("uses the token scale, not ad-hoc sizes or white alphas", async () => {
    await render();
    await click("Next week");
    const html = container.innerHTML;
    expect(html).not.toMatch(/text-\[[\d.]+px\]/);
    expect(html).not.toMatch(/\btext-(xs|sm)\b/);
    expect(html).not.toMatch(/text-white\//);
    expect(html).not.toMatch(/bg-white\//);
    expect(html).not.toMatch(/border-white\//);
  });
});
