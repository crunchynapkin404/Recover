// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { computeAccessibleName } from "dom-accessibility-api";
import { WeekStrip } from "./week-strip";
import type { DaySlot, ScheduledWorkout } from "@/lib/week-plan/types";
import { withPurpose } from "@/lib/training-plan";
import { blockPlacement } from "@/lib/week-plan/placement";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement;

async function render(ui: React.ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(ui);
  });
  return container;
}

afterEach(async () => {
  if (root) {
    const r = root;
    await act(async () => r.unmount());
    root = null;
  }
  container?.remove();
});

// ── fixtures ────────────────────────────────────────────────────────────

const workout = (
  durationMins: number,
  type: string,
  overrides: Partial<ScheduledWorkout> = {}
): ScheduledWorkout =>
  ({
    ...withPurpose({
      day: 0,
      sport: "Ride",
      type,
      durationMins,
      intensity: "Z1-Z2",
      description: "",
      placement: blockPlacement(0),
    }),
    ...overrides,
  }) as ScheduledWorkout;

const day = (
  date: string,
  status: DaySlot["status"],
  workouts: ScheduledWorkout[] = [],
  overrides: Partial<DaySlot> = {}
): DaySlot => ({
  date,
  availableBlocks: [],
  availableMins: 0,
  workouts,
  status,
  ...overrides,
});

// Monday 2026-08-24 .. Sunday 2026-08-30. Exactly one hard day (Thursday,
// threshold, 95 min) so "puts a notch on hard days only" has a single
// answer to check against.
const week: DaySlot[] = [
  day("2026-08-24", "rest"),
  day("2026-08-25", "planned", [workout(45, "Endurance")]),
  day("2026-08-26", "rest"),
  day("2026-08-27", "planned", [workout(95, "Tempo")]),
  day("2026-08-28", "planned", [workout(30, "Recovery")]),
  day("2026-08-29", "planned", [workout(120, "Long")]),
  day("2026-08-30", "rest"),
];

const raceWeek: DaySlot[] = [
  day("2026-08-24", "rest"),
  day("2026-08-25", "planned", [workout(45, "Endurance")]),
  day("2026-08-26", "rest"),
  day("2026-08-27", "planned", [workout(60, "Endurance")]),
  day("2026-08-28", "rest"),
  day("2026-08-29", "race", [], { raceName: "Club Crit" }),
  day("2026-08-30", "rest"),
];

// The pre-existing seven days this test suite covered before the rewrite —
// a mix of statuses with and without a session, run through the SAME
// component with no selectedDate/hrefForDay/marks. This is Today's week
// row: it must keep working exactly as it did (v0.121.0's 152px overflow
// fix lives in the outer container these share, and the reviewer's ruling
// in Task 3 fix round 1 keeps Today on dots by default).
const run = withPurpose({
  day: 0,
  sport: "Run",
  type: "Endurance",
  durationMins: 45,
  intensity: "Z1-Z2",
  description: "Easy run",
  placement: blockPlacement(0),
}) as ScheduledWorkout;

const legacyDays: DaySlot[] = [
  day("2026-07-20", "completed", [run]),
  day("2026-07-21", "missed"), // adaptDay wipes workouts on a missed day
  day("2026-07-22", "rest"),
  day("2026-07-23", "planned", [run]),
  day("2026-07-24", "adapted", [run]),
  day("2026-07-25", "moved", [run]),
  day("2026-07-26", "rest"),
];

describe("WeekStrip — Today's non-interactive, dots-by-default week row", () => {
  it("renders nothing for null days — no empty claims", async () => {
    const el = await render(<WeekStrip days={null} />);
    expect(el.innerHTML).toBe("");
  });

  it("renders no anchors — Today's row must stay non-interactive", async () => {
    const el = await render(<WeekStrip days={legacyDays} />);
    expect(el.querySelectorAll("a").length).toBe(0);
  });

  it("renders 7 status marks for 7 days", async () => {
    const el = await render(<WeekStrip days={legacyDays} />);
    expect(el.querySelectorAll("[data-status]").length).toBe(7);
  });

  it("status classes differ: completed vs missed vs rest", async () => {
    const el = await render(<WeekStrip days={legacyDays} />);
    // v0.99 slice 1 moved these onto theme tokens (see STATUS_DOT's
    // comment) — bg-emerald-400 → bg-chart-2, bg-red-400 → bg-chart-5,
    // bg-white/15 → bg-hairline.
    expect(el.innerHTML).toContain("bg-chart-2");
    expect(el.innerHTML).toContain("bg-chart-5");
    expect(el.innerHTML).toContain("bg-hairline");
  });

  it("an adapted day carries a visually distinct marker", async () => {
    const el = await render(<WeekStrip days={legacyDays} />);
    expect(el.innerHTML).toContain("bg-chart-3");
  });

  // I4, whole-branch review 2026-08-12: the strip's own comment says
  // gap-x-2 is load-bearing — at 12px, the seven day labels ("Mo" … "Su")
  // clear each other under justify-between alone only because of this gap;
  // without it they collide into "MOTUWETHFRSASU" whenever the strip is
  // squeezed (Today's desktop week row puts it in a flex-1 beside the
  // volume summary). Every other test here was green with that gap
  // deleted, so this is the only thing that would have caught it.
  it("keeps the load-bearing gap between day columns", async () => {
    const el = await render(<WeekStrip days={legacyDays} />);
    expect(el.querySelector('[class*="gap-x-2"]')).not.toBeNull();
  });

  // The other half of the same problem: the day columns cannot shrink
  // below their labels, so a container narrower than this strip's
  // min-content used to leave the seven days rendering OUTSIDE the
  // bordered bubble. At 1024px Today's week row squeezed the bubble to
  // 42px while the days spanned 173px, drawing the border straight
  // through them. min-w-fit is what keeps the bubble around the days it
  // is drawn for.
  it("refuses to render its bubble narrower than the days inside it", async () => {
    const el = await render(<WeekStrip days={legacyDays} />);
    expect(el.querySelector('[class*="min-w-fit"]')).not.toBeNull();
  });

  it("defaults to dots and never renders a notch, even on a hard day", async () => {
    const el = await render(<WeekStrip days={week} />);
    // `week` has exactly one hard day (Thursday) — the bars-mode test
    // below proves that would otherwise produce one [data-hard]. Zero
    // here proves dots stayed dots.
    expect(el.querySelectorAll("[data-hard]").length).toBe(0);
  });

  it("renders the plain status dot, not an inline-height bar", async () => {
    const el = await render(<WeekStrip days={week} />);
    const thuMark = el.querySelector('[data-date="2026-08-27"] [data-status]');
    // The dot is a fixed-size circle (h-2.5 w-2.5); the bar variant sizes
    // itself with an inline `style="height:…"` this mark must not have.
    expect(thuMark?.className).toContain("h-2.5");
    expect(thuMark?.hasAttribute("style")).toBe(false);
  });

  /**
   * Review round 1, Finding 1 (Critical): a bare `<div>`'s implicit ARIA
   * role is "generic", and WAI-ARIA 1.2 explicitly PROHIBITS an accessible
   * name on "generic" — conformant tools drop `aria-label` there, so the
   * previous version of this test (asserting the raw attribute was
   * present in the DOM) proved nothing about what a screen reader would
   * actually announce. `computeAccessibleName` runs the real AccName
   * computation (the same engine @testing-library and axe-core's `label`
   * rule use — see apple-health-card.a11y.test.tsx for the precedent) so
   * a `role` regression here fails this test instead of passing it.
   */
  it("gives every day a REAL accessible name — computed, not just present in markup", async () => {
    const el = await render(<WeekStrip days={week} />);
    const thu = el.querySelector('[data-date="2026-08-27"]') as HTMLElement;
    // `computeAccessibleName` alone does not catch a missing role here:
    // dom-accessibility-api 0.5.16 computes aria-label's text regardless
    // of role, so it does not itself model ARIA 1.2's "name prohibited on
    // generic" rule the way current screen readers do (verified directly:
    // removing role="group" left this string assertion passing). The
    // explicit role check is therefore the real regression guard; the
    // name assertion below independently pins the label text itself.
    expect(thu.getAttribute("role")).toBe("group");
    expect(computeAccessibleName(thu)).toBe(
      "Thursday, 95 minutes, hard session, planned"
    );
  });

  it("names a rest day as rest even without a link", async () => {
    const el = await render(<WeekStrip days={week} />);
    const mon = el.querySelector('[data-date="2026-08-24"]') as HTMLElement;
    expect(computeAccessibleName(mon)).toBe("Monday, rest");
  });
});

// I1, final whole-branch review: a raw `<a href>` here does a full document
// reload on every tap — this repo already fixed the exact same bug on
// "Set next week's availability" (see page.tsx's comment on that Link),
// specifically so a client-side transition survives with component state
// (the availability switcher instance, open Collapsibles) intact. Rendered
// jsdom output can't tell `next/link`'s `<a>` apart from a raw one — both
// end up an `<a href>` in the DOM — so this pins the SOURCE instead: no
// literal `<a` JSX tag, and a real `next/link` import backing the one
// anchor-shaped thing on the page.
describe("WeekStrip — I1: day navigation is next/link, not a raw anchor", () => {
  const src = readFileSync("src/components/week/week-strip.tsx", "utf8");

  it("imports next/link", () => {
    expect(src).toMatch(/^import Link from "next\/link";$/m);
  });

  it("never writes a raw <a> JSX tag", () => {
    expect(src).not.toMatch(/<a[\s>]/);
  });
});

describe('WeekStrip — Train\'s interactive bar strip (hrefForDay + marks="bars")', () => {
  it("gives every day a link and an accessible name that reads as a sentence", async () => {
    const el = await render(
      <WeekStrip
        days={week}
        selectedDate="2026-08-27"
        hrefForDay={(d) => `/train?day=${d}`}
        marks="bars"
      />
    );
    const thu = el.querySelector(
      'a[href="/train?day=2026-08-27"]'
    ) as HTMLElement;
    expect(computeAccessibleName(thu)).toBe(
      "Thursday, 95 minutes, hard session, planned"
    );
  });

  // A bar chart is not a label. Sighted athletes read height; everyone else
  // reads this string, and it must carry the same two channels.
  it("names a rest day as rest rather than as zero minutes", async () => {
    const el = await render(
      <WeekStrip
        days={week}
        selectedDate={null}
        hrefForDay={(d) => `/train?day=${d}`}
        marks="bars"
      />
    );
    const mon = el.querySelector(
      'a[href="/train?day=2026-08-24"]'
    ) as HTMLElement;
    expect(computeAccessibleName(mon)).toBe("Monday, rest");
  });

  it("marks the selected day for assistive tech, not only in colour", async () => {
    const el = await render(
      <WeekStrip
        days={week}
        selectedDate="2026-08-27"
        hrefForDay={(d) => `/train?day=${d}`}
        marks="bars"
      />
    );
    expect(
      el
        .querySelector('a[href="/train?day=2026-08-27"]')
        ?.getAttribute("aria-current")
    ).toBe("true");
  });

  it("does not mark an unselected day as current", async () => {
    const el = await render(
      <WeekStrip
        days={week}
        selectedDate="2026-08-27"
        hrefForDay={(d) => `/train?day=${d}`}
        marks="bars"
      />
    );
    expect(
      el
        .querySelector('a[href="/train?day=2026-08-24"]')
        ?.hasAttribute("aria-current")
    ).toBe(false);
  });

  it("puts a notch on hard days only", async () => {
    const el = await render(
      <WeekStrip
        days={week}
        selectedDate={null}
        hrefForDay={(d) => `/train?day=${d}`}
        marks="bars"
      />
    );
    expect(el.querySelectorAll("[data-hard]").length).toBe(1);
  });

  // Review round 1, Finding 2: the bar's height was capped by flexbox
  // shrink at ~81% of the scale, so the week's longest day and anything
  // within ~19 points of it rendered at the same pixel height. jsdom
  // computes no layout, so this pins the actual inline style instead —
  // the number that would have been wrong.
  it("gives the week's longest day the bar's full height budget", async () => {
    const el = await render(
      <WeekStrip
        days={week}
        selectedDate={null}
        hrefForDay={(d) => `/train?day=${d}`}
        marks="bars"
      />
    );
    // Saturday (120 min) is `week`'s longest day, so heightPct is 100 and
    // the bar should get the full 26px budget (32px track − 4px notch −
    // 2px gap), not the ~26px a shrink bug would have coincidentally also
    // produced — the real assertion is that it is NOT silently clamped
    // below what a shorter-but-still-tall day would also render at.
    const sat = el.querySelector(
      'a[href="/train?day=2026-08-29"] [data-status="planned"]'
    ) as HTMLElement;
    const fri = el.querySelector(
      'a[href="/train?day=2026-08-28"] [data-status="planned"]'
    ) as HTMLElement;
    const satPx = parseFloat(sat.style.height);
    const friPx = parseFloat(fri.style.height);
    expect(satPx).toBe(26);
    // Friday is 30 min against a 120 min max: 25% of the scale, well
    // under the ~81% flattening threshold either way, but strictly less
    // than Saturday's height either way this is computed.
    expect(friPx).toBeLessThan(satPx);
  });

  it("keeps the race glyph", async () => {
    const el = await render(
      <WeekStrip
        days={raceWeek}
        selectedDate={null}
        hrefForDay={(d) => `/train?day=${d}`}
        marks="bars"
      />
    );
    expect(el.querySelector('[data-status="race"]')).not.toBeNull();
  });
});

// I2, final whole-branch review: `highlightDate = selectedDate ?? today`
// meant the ring followed whichever day was OPEN, and Train always passes
// `selectedDate` — so on Train the ring never once meant "today", contrary
// to the spec ("Today's bar carries the existing focus ring"). These use a
// week built off the REAL current date (not the fixed 2026-08-24..30
// fixture, which can coincidentally contain the real run date and mask
// this) so WeekStrip's own `new Date()`-derived "today" lines up with a
// day these tests control directly.
describe("WeekStrip — I2: today's ring and the open day's mark are independent", () => {
  function localYmd(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  function addDays(ymd: string, n: number): string {
    const d = new Date(ymd + "T00:00:00");
    d.setDate(d.getDate() + n);
    return localYmd(d);
  }
  const REAL_TODAY = localYmd(new Date());
  const OTHER_DAY = addDays(REAL_TODAY, 3);
  const sessionWeek: DaySlot[] = Array.from({ length: 7 }, (_, i) =>
    day(addDays(REAL_TODAY, i), "planned", [workout(45, "Endurance")])
  );

  it("rings today's bar even when a different day is open", async () => {
    const el = await render(
      <WeekStrip
        days={sessionWeek}
        selectedDate={OTHER_DAY}
        hrefForDay={(d) => `/train?day=${d}`}
        marks="bars"
      />
    );
    const todayMark = el.querySelector(
      `[data-date="${REAL_TODAY}"] [data-status]`
    );
    expect(todayMark?.className).toContain("ring-2");
    // The open day is a different day and must not itself carry today's ring.
    const openMark = el.querySelector(
      `[data-date="${OTHER_DAY}"] [data-status]`
    );
    expect(openMark?.className).not.toContain("ring-2");
  });

  it("gives the open day its own mark, distinct from today's ring", async () => {
    const el = await render(
      <WeekStrip
        days={sessionWeek}
        selectedDate={OTHER_DAY}
        hrefForDay={(d) => `/train?day=${d}`}
        marks="bars"
      />
    );
    const openColumn = el.querySelector(`[data-date="${OTHER_DAY}"]`);
    expect(openColumn?.getAttribute("data-open")).toBe("true");
    // Today is not the open day here, so it must not carry the open mark.
    const todayColumn = el.querySelector(`[data-date="${REAL_TODAY}"]`);
    expect(todayColumn?.getAttribute("data-open")).not.toBe("true");
  });

  it("paints the open column with a ground that is distinct from its container, not the one that collides with it", async () => {
    // jsdom has no computed colour, so this cannot see that the pill is
    // invisible — that's a real-browser fact, guarded instead by
    // tests/contrast-guard.test.ts's per-token ratios plus the globals.css
    // comment on --surface-selected. What jsdom CAN see is which CLASS is
    // on the element: bg-surface-overlay is a no-op here because the
    // column's container (week-strip's outer div) is bg-surface-raised,
    // and --surface-raised and --surface-overlay are BOTH #ffffff in light
    // (globals.css :root). bg-surface-selected is the token the repo
    // already uses for exactly this "highlight inside a raised container"
    // collision (see its comment in globals.css), and it differs from
    // surface-raised in both themes. Pin the class, as a stand-in for the
    // contrast that class is responsible for producing.
    const el = await render(
      <WeekStrip
        days={sessionWeek}
        selectedDate={OTHER_DAY}
        hrefForDay={(d) => `/train?day=${d}`}
        marks="bars"
      />
    );
    const openColumn = el.querySelector(`[data-date="${OTHER_DAY}"]`);
    expect(openColumn?.className).toContain("bg-surface-selected");
    expect(openColumn?.className).not.toContain("bg-surface-overlay");
  });

  it("shows both marks together when the open day IS today", async () => {
    const el = await render(
      <WeekStrip
        days={sessionWeek}
        selectedDate={REAL_TODAY}
        hrefForDay={(d) => `/train?day=${d}`}
        marks="bars"
      />
    );
    const todayColumn = el.querySelector(`[data-date="${REAL_TODAY}"]`);
    expect(todayColumn?.getAttribute("data-open")).toBe("true");
    const todayMark = el.querySelector(
      `[data-date="${REAL_TODAY}"] [data-status]`
    );
    expect(todayMark?.className).toContain("ring-2");
  });
});

describe("WeekStrip — marks and hrefForDay are independent knobs", () => {
  // Review round 1, Finding 4 (ruling): a first pass keyed the visual
  // mark off whether hrefForDay was present, so Today's week row silently
  // went from dots to bars as a side effect of Train gaining links. These
  // two tests pin the cross product directly so that regression can't
  // come back the same way.
  it("renders bars without any link", async () => {
    const el = await render(<WeekStrip days={week} marks="bars" />);
    expect(el.querySelectorAll("a").length).toBe(0);
    expect(el.querySelectorAll("[data-hard]").length).toBe(1);
  });

  it("renders dots even when every day is a link", async () => {
    const el = await render(
      <WeekStrip
        days={week}
        hrefForDay={(d) => `/train?day=${d}`}
        marks="dots"
      />
    );
    expect(el.querySelectorAll("a").length).toBe(7);
    expect(el.querySelectorAll("[data-hard]").length).toBe(0);
  });
});
