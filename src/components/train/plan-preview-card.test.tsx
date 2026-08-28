// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PlanPreviewCard } from "./plan-preview-card";
import { WARNING_TEXT, type PlanPreview } from "@/lib/plan-preview";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// "use server" is a genuine module boundary, not the logic under test —
// same stubbing convention as races-section-demand.test.tsx. Default to
// success so the tests that never touch the buttons aren't affected;
// individual tests override with mockResolvedValueOnce/mockRejectedValueOnce.
vi.mock("@/app/plan/actions", () => ({
  confirmPlanAction: vi.fn(async () => ({ ok: true, planId: "plan-1" })),
  regeneratePreviewAction: vi.fn(async () => ({ ok: true, preview: {} })),
}));

import { confirmPlanAction, regeneratePreviewAction } from "@/app/plan/actions";

const confirmPlanActionMock = vi.mocked(confirmPlanAction);
const regeneratePreviewActionMock = vi.mocked(regeneratePreviewAction);

// `build`'s `weeks` (2) deliberately disagrees with its own
// `weekNumbers.length` (3), and both disagree with `weeksTotal` (6). That
// makes the three candidate implementations of the total cell land on three
// different numbers instead of one:
//   - sum(phases[].weeks)            -> 3 + 2 + 1 + 1 = 7  (correct)
//   - sum(phases[].weekNumbers.length) -> 3 + 3 + 1 + 1 = 8  (wrong field)
//   - echo weeksTotal                -> 6                   (ignores phases)
// A fixture where all three agreed (as the original one did, at 6/6/6) could
// not tell a correct component from either mutant.
const preview: PlanPreview = {
  planId: "11111111-1111-1111-1111-111111111111",
  sport: "Bike",
  race: {
    id: null,
    name: "Dolomites Gran Fondo",
    date: "2026-09-13",
    priority: "A",
  },
  firstRace: null,
  startDate: "2026-08-05",
  weeksTotal: 6,
  // Deliberately NOT 5/8 (the old hardcoded `useState` defaults) — Finding 3
  // (final review): the Rebuild inputs must start from what actually
  // produced this draft, not a guess that silently overrides an athlete who
  // asked for 6 days and 10 hours.
  daysPerWeek: 6,
  hoursPerWeek: 10,
  phases: [
    {
      segment: 1,
      phase: "base",
      weeks: 3,
      weekNumbers: [1, 2, 4],
      isBridge: false,
    },
    {
      segment: 1,
      phase: "build",
      weeks: 2,
      weekNumbers: [5, 7, 9],
      isBridge: false,
    },
    { segment: 1, phase: "taper", weeks: 1, weekNumbers: [6], isBridge: false },
    {
      segment: 1,
      phase: "recovery",
      weeks: 1,
      weekNumbers: [3],
      isBridge: false,
    },
  ],
  weeks: Array.from({ length: 6 }, (_, i) => ({
    weekNumber: i + 1,
    phase: "base" as const,
    targetLoad: 400 + i * 10,
    targetHours: 8,
    raceName: i === 5 ? "Dolomites Gran Fondo" : null,
    isBridge: false,
  })),
  startingCtl: { value: 30, source: "global_fallback" },
  feasibility: null,
  volume: { source: "fallback", shortfall: null },
  warnings: ["no_ctl_history", "volume_fallback", "race_created"],
};

let root: Root | null = null;
let container: HTMLDivElement;

function mount() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<PlanPreviewCard preview={preview} />);
  });
}

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  container?.remove();
  vi.clearAllMocks();
});

async function clickButton(matcher: RegExp) {
  const btn = Array.from(container.querySelectorAll("button")).find((b) =>
    matcher.test(b.textContent ?? "")
  );
  if (!btn) throw new Error(`no button matching ${matcher}`);
  await act(async () => {
    btn.click();
  });
}

describe("PlanPreviewCard", () => {
  it("names the sport and the race", () => {
    mount();
    expect(container.textContent).toContain("Dolomites Gran Fondo");
    expect(container.textContent).toMatch(/Cycling|Bike/);
  });

  // The release's headline requirement: the athlete can check the sum. The
  // fixture's `build` row makes `weeks` (2), `weekNumbers.length` (3), and
  // `weeksTotal` (6) three different numbers, so only a component that
  // actually sums `phases[].weeks` lands on the expected 7 here — summing
  // `weekNumbers.length` would show 8, and echoing `weeksTotal` would show 6.
  it("shows every phase row and a total equal to the sum of phase weeks", () => {
    mount();
    for (const row of preview.phases) {
      const el = container.querySelector(
        `[data-testid="phase-${row.segment}-${row.phase}"]`
      );
      expect(el).toBeTruthy();
      expect(el!.textContent).toContain(String(row.weeks));
    }
    const expectedTotal = preview.phases.reduce(
      (sum, row) => sum + row.weeks,
      0
    );
    expect(expectedTotal).toBe(7); // sanity: pins the fixture's own arithmetic
    expect(
      container.querySelector('[data-testid="phase-total"]')!.textContent
    ).toBe(String(expectedTotal));
  });

  // Task 8, Step 4: a single-race plan (every row at segment 1, this
  // fixture's shape) must render byte-identically to today — no spanning
  // header row at all, since there is only one arc to distinguish.
  it("renders no segment header for a single-race plan", () => {
    mount();
    expect(
      container.querySelectorAll('[data-testid^="segment-"]')
    ).toHaveLength(0);
  });

  it("renders one sentence per warning", () => {
    mount();
    for (const w of preview.warnings) {
      expect(container.textContent).toContain(WARNING_TEXT[w]);
    }
  });

  // Finding 3 (final review): the inputs used to hardcode useState(5)/
  // useState(8) regardless of what actually produced the shown draft, so
  // Rebuild would silently discard an athlete's stated 6-days/10-hours
  // preference. They must start from the draft's own constraints.
  it("initialises the Rebuild inputs from the draft's own constraints, not a hardcoded guess", () => {
    mount();
    const daysInput = container.querySelector(
      '[aria-label="Days per week"]'
    ) as HTMLInputElement;
    const hoursInput = container.querySelector(
      '[aria-label="Hours per week"]'
    ) as HTMLInputElement;
    expect(daysInput.value).toBe(String(preview.daysPerWeek));
    expect(hoursInput.value).toBe(String(preview.hoursPerWeek));
  });

  it("offers the three decisions by name, and nothing to tune periodization with", () => {
    mount();

    const startButton = Array.from(container.querySelectorAll("button")).find(
      (b) => /start this plan/i.test(b.textContent ?? "")
    );
    expect(startButton).toBeTruthy();

    const daysInput = container.querySelector('[aria-label="Days per week"]');
    expect(daysInput).toBeTruthy();

    const hoursInput = container.querySelector('[aria-label="Hours per week"]');
    expect(hoursInput).toBeTruthy();

    // Nothing else is editable — periodization (phase lengths, where
    // recovery weeks land) gets the table above, not a control.
    const periodizationControl = Array.from(
      container.querySelectorAll("input, select, textarea")
    ).find((el) =>
      /progression|recovery/i.test(el.getAttribute("aria-label") ?? "")
    );
    expect(periodizationControl).toBeUndefined();
  });

  // Finding 1: both buttons used to discard the result of their action,
  // so an athlete pressing "Start this plan" against a stale draft (replaced
  // from another tab, or by a new coach proposal) saw nothing — no plan
  // change, no explanation. These pin that a non-ok result now renders.
  describe("when an action reports the draft is no longer current", () => {
    it("tells the athlete after Start this plan fails", async () => {
      confirmPlanActionMock.mockResolvedValueOnce({
        ok: false,
        reason: "not_found",
      });
      mount();
      await clickButton(/start this plan/i);
      expect(container.textContent).toContain(
        "This proposal is no longer current, so ask your coach for a fresh one."
      );
    });

    it("tells the athlete after Rebuild fails", async () => {
      regeneratePreviewActionMock.mockResolvedValueOnce({
        ok: false,
        reason: "not_found",
      });
      mount();
      await clickButton(/^rebuild$/i);
      expect(container.textContent).toContain(
        "This proposal is no longer current, so ask your coach for a fresh one."
      );
    });
  });

  // Final-review Finding 1: confirmTrainingPlan refuses when the race this
  // draft targets has since changed sport. That gets its own sentence, not
  // the generic "no longer current" one — the athlete needs to know WHY.
  it("tells the athlete the race changed sport when Start this plan refuses for that reason", async () => {
    confirmPlanActionMock.mockResolvedValueOnce({
      ok: false,
      reason: "sport_changed",
    });
    mount();
    await clickButton(/start this plan/i);
    expect(container.textContent).toContain(
      "The race this plan targets has since changed sport, so this plan no longer matches it. Ask your coach for a fresh plan."
    );
  });

  it("tells the athlete when the request itself fails", async () => {
    confirmPlanActionMock.mockRejectedValueOnce(new Error("network error"));
    mount();
    await clickButton(/start this plan/i);
    expect(container.textContent).toContain(
      "That didn't go through and nothing has changed, so try again in a moment."
    );
  });

  it("clears a previous failure once the same action succeeds", async () => {
    confirmPlanActionMock.mockResolvedValueOnce({
      ok: false,
      reason: "not_found",
    });
    mount();
    await clickButton(/start this plan/i);
    expect(
      container.querySelector('[data-testid="plan-preview-error"]')
    ).not.toBeNull();

    confirmPlanActionMock.mockResolvedValueOnce({
      ok: true,
      planId: preview.planId,
    });
    await clickButton(/start this plan/i);
    expect(
      container.querySelector('[data-testid="plan-preview-error"]')
    ).toBeNull();
  });

  it("uses the token scale, not ad-hoc sizes or white alphas", () => {
    mount();
    const html = container.innerHTML;
    expect(html).not.toMatch(/text-\[[\d.]+px\]/);
    expect(html).not.toMatch(/\btext-(xs|sm)\b/);
    expect(html).not.toMatch(/text-white\//);
    expect(html).not.toMatch(/bg-white\//);
    expect(html).not.toMatch(/border-white\//);
  });

  // Task 8, Steps 3-4: a two-arc plan has two `base` rows and two `taper`
  // rows sharing a `phase` — the React key collision this release fixes —
  // and must show which arc each row belongs to.
  describe("a two-arc (two-A-race) plan", () => {
    const twoArcPreview: PlanPreview = {
      ...preview,
      phases: [
        {
          segment: 1,
          phase: "base",
          weeks: 4,
          weekNumbers: [1, 2, 3, 4],
          isBridge: false,
        },
        {
          segment: 1,
          phase: "taper",
          weeks: 1,
          weekNumbers: [5],
          isBridge: false,
        },
        {
          segment: 1,
          phase: "recovery",
          weeks: 1,
          weekNumbers: [6],
          isBridge: false,
        },
        {
          segment: 2,
          phase: "base",
          weeks: 2,
          weekNumbers: [7, 8],
          isBridge: false,
        },
        {
          segment: 2,
          phase: "taper",
          weeks: 1,
          weekNumbers: [9],
          isBridge: false,
        },
      ],
    };

    let twoArcRoot: Root | null = null;
    let twoArcContainer: HTMLDivElement;

    function mountTwoArc() {
      twoArcContainer = document.createElement("div");
      document.body.appendChild(twoArcContainer);
      twoArcRoot = createRoot(twoArcContainer);
      act(() => {
        twoArcRoot!.render(<PlanPreviewCard preview={twoArcPreview} />);
      });
    }

    afterEach(() => {
      if (twoArcRoot) act(() => twoArcRoot!.unmount());
      twoArcRoot = null;
      twoArcContainer?.remove();
    });

    it("gives each arc its own header row and each phase row a distinct testid", () => {
      mountTwoArc();

      const headers = twoArcContainer.querySelectorAll(
        '[data-testid^="segment-"]'
      );
      expect(headers).toHaveLength(2);
      expect(
        twoArcContainer.querySelector('[data-testid="segment-1"]')!.textContent
      ).toContain("First race");
      expect(
        twoArcContainer.querySelector('[data-testid="segment-2"]')!.textContent
      ).toContain(twoArcPreview.race.name);

      // Two "base" rows and two "taper" rows, one per segment — distinct
      // data-testids (and React keys), not a collision on `phase` alone.
      for (const testid of [
        "phase-1-base",
        "phase-1-taper",
        "phase-1-recovery",
        "phase-2-base",
        "phase-2-taper",
      ]) {
        expect(
          twoArcContainer.querySelector(`[data-testid="${testid}"]`)
        ).toBeTruthy();
      }
    });

    it("uses the token scale for the segment header too", () => {
      mountTwoArc();
      const html = twoArcContainer.innerHTML;
      expect(html).not.toMatch(/text-\[[\d.]+px\]/);
      expect(html).not.toMatch(/\btext-(xs|sm)\b/);
    });
  });
});

// This is the ONE component of the nine that gained the sheet's
// `bg-surface-selected` fix in this slice that actually renders in two
// contexts (every other one is sheet-only) -- see the `variant` prop's own
// doc comment. Both branches are pinned here, the same shape as
// event-readiness.test.tsx / standard-week.test.tsx / races-section.test.tsx
// pin the sheet-only fix elsewhere: this is the one component where getting
// it backwards (or dropping the `variant` split entirely) would actually
// ship an invisible card, so it is the one that most needs its own guard.
describe("PlanPreviewCard surface (variant prop)", () => {
  let root: Root | null = null;
  let container: HTMLDivElement;

  function mountVariant(variant?: "page" | "sheet") {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root!.render(<PlanPreviewCard preview={preview} variant={variant} />);
    });
  }

  afterEach(() => {
    if (root) act(() => root!.unmount());
    root = null;
    container?.remove();
  });

  // Default (no `variant` prop, and the explicit "page" call site --
  // train/page.tsx's `!plan` early return, which has no sheet machinery at
  // all): `.glass`, the same ground every other page-level card uses.
  it("fills the page variant with glass, not surface-selected", () => {
    mountVariant();
    const html = container.innerHTML;
    expect(html).toMatch(/\bglass\b/);
    expect(html).not.toContain("bg-surface-selected");

    mountVariant("page");
    const explicitHtml = container.innerHTML;
    expect(explicitHtml).toMatch(/\bglass\b/);
    expect(explicitHtml).not.toContain("bg-surface-selected");
  });

  // `variant="sheet"` (the "plan-review" sheet, train/page.tsx): the sheet
  // panel is `bg-surface-overlay`, and `.glass` resolves to
  // `--surface-raised`, which equals `--surface-overlay` in light mode
  // (both #ffffff) -- an invisible fill behind a bare hairline, the exact
  // collision this component shipped with before this fix.
  // `--surface-selected` is what the rest of this app's sheet content uses
  // instead.
  it("fills the sheet variant with surface-selected, not glass", () => {
    mountVariant("sheet");
    const html = container.innerHTML;
    expect(html).toContain("border-hairline");
    expect(html).toContain("bg-surface-selected");
    expect(html).not.toMatch(/\bglass\b/);
  });
});

describe("two-arc labelling", () => {
  const twoArc: PlanPreview = {
    ...preview,
    firstRace: { id: "r1", name: "Spring Marathon", date: "2026-11-12" },
    race: { ...preview.race, name: "Autumn Marathon" },
    phases: [
      {
        segment: 1,
        phase: "base",
        weeks: 2,
        weekNumbers: [1, 2],
        isBridge: false,
      },
      {
        segment: 1,
        phase: "recovery",
        weeks: 1,
        weekNumbers: [3],
        isBridge: false,
      },
      {
        segment: 1,
        phase: "recovery",
        weeks: 2,
        weekNumbers: [4, 5],
        isBridge: true,
      },
      {
        segment: 2,
        phase: "taper",
        weeks: 1,
        weekNumbers: [6],
        isBridge: false,
      },
    ],
  };

  let root: Root | null = null;
  let container: HTMLDivElement;

  function mount(p: PlanPreview) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root!.render(<PlanPreviewCard preview={p} />);
    });
  }

  afterEach(() => {
    if (root) act(() => root!.unmount());
    root = null;
    container?.remove();
  });

  it("names segment 1 after the first race, not a placeholder", () => {
    mount(twoArc);
    expect(
      container.querySelector('[data-testid="segment-1"]')!.textContent
    ).toContain("Spring Marathon");
    expect(
      container.querySelector('[data-testid="segment-2"]')!.textContent
    ).toContain("Autumn Marathon");
    // The placeholder read as unfinished sitting above a real race name.
    expect(container.textContent).not.toContain("First race");
  });

  it("names the bridge instead of calling it another Recovery row", () => {
    mount(twoArc);
    const bridge = container.querySelector('[data-testid="phase-bridge"]')!;
    expect(bridge.textContent).toContain("Recovery between races");
    expect(bridge.textContent).toContain("weeks 4, 5");
    // The arc's OWN easy week stays a separate, ordinary Recovery row --
    // merging the two is what made the bridge invisible on screen.
    expect(
      container.querySelector('[data-testid="phase-1-recovery"]')!.textContent
    ).toContain("weeks 3");
  });

  it("falls back when the first race row was deleted underneath the draft", () => {
    mount({ ...twoArc, firstRace: null });
    expect(
      container.querySelector('[data-testid="segment-1"]')!.textContent
    ).toContain("First race");
  });
});
