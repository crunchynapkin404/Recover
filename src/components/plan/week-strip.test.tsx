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
    expect(html).toContain("bg-emerald-400");
    expect(html).toContain("bg-red-400");
    expect(html).toContain("bg-white/15");
  });

  it("an adapted day carries a visually distinct marker", () => {
    const html = renderToString(<WeekStrip days={days} />);
    expect(html).toContain("bg-amber-400");
  });
});
