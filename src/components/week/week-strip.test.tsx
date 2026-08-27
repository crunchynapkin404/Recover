// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { WeekStrip } from "./week-strip";
import type { DaySlot, ScheduledWorkout } from "@/lib/week-plan/types";
import { withPurpose } from "@/lib/training-plan";

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
      blockIdx: 0,
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
// component with no selectedDate/hrefForDay. This is Today's week row: it
// must keep working exactly as it did (v0.121.0's 152px overflow fix lives
// in the outer container these share).
const run = withPurpose({
  day: 0,
  sport: "Run",
  type: "Endurance",
  durationMins: 45,
  intensity: "Z1-Z2",
  description: "Easy run",
  blockIdx: 0,
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

describe("WeekStrip — Today's non-interactive week row (no hrefForDay)", () => {
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

  it("still gives every day an accessible name even without a link", async () => {
    const el = await render(<WeekStrip days={week} />);
    expect(
      el.querySelector(
        '[aria-label="Thursday, 95 minutes, hard session, planned"]'
      )
    ).not.toBeNull();
  });
});

describe("WeekStrip — Train's interactive strip (hrefForDay present)", () => {
  it("gives every day a link and an accessible name that reads as a sentence", async () => {
    const el = await render(
      <WeekStrip
        days={week}
        selectedDate="2026-08-27"
        hrefForDay={(d) => `/train?day=${d}`}
      />
    );
    const thu = el.querySelector('a[href="/train?day=2026-08-27"]');
    expect(thu?.getAttribute("aria-label")).toBe(
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
      />
    );
    const mon = el.querySelector('a[href="/train?day=2026-08-24"]');
    expect(mon?.getAttribute("aria-label")).toBe("Monday, rest");
  });

  it("marks the selected day for assistive tech, not only in colour", async () => {
    const el = await render(
      <WeekStrip
        days={week}
        selectedDate="2026-08-27"
        hrefForDay={(d) => `/train?day=${d}`}
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
      />
    );
    expect(el.querySelectorAll("[data-hard]").length).toBe(1);
  });

  it("keeps the race glyph", async () => {
    const el = await render(
      <WeekStrip
        days={raceWeek}
        selectedDate={null}
        hrefForDay={(d) => `/train?day=${d}`}
      />
    );
    expect(el.querySelector('[data-status="race"]')).not.toBeNull();
  });
});
