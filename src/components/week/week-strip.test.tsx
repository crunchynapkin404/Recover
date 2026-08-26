import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { WeekStrip } from "./week-strip";
import type { DaySlot } from "@/lib/week-plan/types";
import { withPurpose } from "@/lib/training-plan";

const slot = (
  date: string,
  status: DaySlot["status"],
  workout: DaySlot["workouts"][number] | null = null
): DaySlot => ({
  date,
  availableBlocks: [
    { start: null, end: null, mins: 60, energy: "normal", sports: null },
  ],
  availableMins: 60,
  workouts: workout ? [workout] : [],
  status,
});

const run = withPurpose({
  day: 0,
  sport: "Run",
  type: "Endurance",
  durationMins: 45,
  intensity: "Z1-Z2",
  description: "Easy run",
  blockIdx: 0,
});

const days: DaySlot[] = [
  slot("2026-07-20", "completed", run),
  slot("2026-07-21", "missed"),
  slot("2026-07-22", "rest"),
  slot("2026-07-23", "planned", run),
  slot("2026-07-24", "adapted", run),
  slot("2026-07-25", "moved", run),
  slot("2026-07-26", "rest"),
];

describe("week strip", () => {
  it("renders nothing for null days — no empty claims", () => {
    expect(renderToString(<WeekStrip days={null} />)).toBe("");
  });

  it("renders 7 status dots for 7 days", () => {
    const html = renderToString(<WeekStrip days={days} />);
    const dots = html.match(/data-status="/g) ?? [];
    expect(dots).toHaveLength(7);
  });

  it("status classes differ: completed vs missed vs rest", () => {
    const html = renderToString(<WeekStrip days={days} />);
    // v0.99 slice 1 moved these onto theme tokens (same colour family, see
    // week-strip.tsx's STATUS_DOT comment) — bg-emerald-400 → bg-chart-2,
    // bg-red-400 → bg-chart-5, bg-white/15 → bg-hairline.
    expect(html).toContain("bg-chart-2");
    expect(html).toContain("bg-chart-5");
    expect(html).toContain("bg-hairline");
  });

  it("an adapted day carries a visually distinct marker", () => {
    const html = renderToString(<WeekStrip days={days} />);
    // bg-amber-400 → bg-chart-3, same colour under a token name.
    expect(html).toContain("bg-chart-3");
  });

  // I4, whole-branch review 2026-08-12: the strip's own comment says
  // gap-x-2 is load-bearing — at 12px, the seven day labels ("Mo" … "Su")
  // clear each other under justify-between alone only because of this gap;
  // without it they collide into "MOTUWETHFRSASU" whenever the strip is
  // squeezed (Today's desktop week row puts it in a flex-1 beside the
  // volume summary). Every other test here was green with that gap
  // deleted, so this is the only thing that would have caught it.
  it("keeps the load-bearing gap between day columns", () => {
    const html = renderToString(<WeekStrip days={days} />);
    expect(html).toMatch(/class="[^"]*\bgap-x-2\b[^"]*"/);
  });

  // The other half of the same problem, and the half the gap could not
  // solve: the day columns cannot shrink below their labels, so a container
  // narrower than this strip's ~215px min-content used to leave the seven
  // days rendering OUTSIDE the bordered bubble rather than inside it. At
  // 1024px Today's week row squeezed the bubble to 42px while the days
  // spanned 173px, drawing the border straight through them. min-w-fit is
  // what keeps the bubble around the days it is drawn for; measured in a
  // real browser at 320-1600px, it never once forces an overflow of its own.
  it("refuses to render its bubble narrower than the days inside it", () => {
    const html = renderToString(<WeekStrip days={days} />);
    expect(html).toMatch(/class="[^"]*\bmin-w-fit\b[^"]*"/);
  });
});
