import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { NextWeekSummary } from "./next-week-summary";
import type { DaySlot } from "@/lib/week-plan/types";
import { withPurpose } from "@/lib/training-plan";

const ride = withPurpose({
  day: 0,
  sport: "Ride",
  type: "Endurance",
  durationMins: 90,
  intensity: "Zone 2",
  description: "",
  blockIdx: 0,
});

const slot = (
  date: string,
  workouts: DaySlot["workouts"],
  availableMins: number
): DaySlot => ({
  date,
  availableBlocks: availableMins
    ? [
        {
          start: null,
          end: null,
          mins: availableMins,
          energy: "normal",
          sports: null,
        },
      ]
    : [],
  availableMins,
  workouts,
  status: workouts.length ? "planned" : "rest",
});

// 3 planned sessions (90 min each = 4.5h), 2 days with room and nothing on
// them, against a 9h target.
const DAYS: DaySlot[] = [
  slot("2026-08-03", [ride], 90),
  slot("2026-08-04", [ride], 90),
  slot("2026-08-05", [], 120),
  slot("2026-08-06", [ride], 90),
  slot("2026-08-07", [], 60),
  slot("2026-08-08", [], 0),
  slot("2026-08-09", [], 0),
];

describe("NextWeekSummary", () => {
  it("summarises the week in counts the page already computes", () => {
    const html = renderToString(
      <NextWeekSummary
        days={DAYS}
        pinned={{}}
        targetHours={9}
        availabilityHref="/train?availability=next"
      >
        <div data-testid="day-rows">seven rows</div>
      </NextWeekSummary>
    );
    expect(html).toContain("3");
    expect(html).toContain("sessions planned");
    expect(html).toContain("2 open");
    expect(html).toContain("4.5h");
    expect(html).toContain("9h target");
  });

  it("keeps the day rows in the DOM but behind a closed disclosure", () => {
    const html = renderToString(
      <NextWeekSummary
        days={DAYS}
        pinned={{}}
        targetHours={9}
        availabilityHref="/train?availability=next"
      >
        <div data-testid="day-rows">seven rows</div>
      </NextWeekSummary>
    );
    // The rows exist — collapsing must not make data unreachable.
    expect(html).toContain("seven rows");
    // …and the disclosure is shut on load.
    expect(html).toContain("<details");
    expect(html).not.toContain("<details open");
    expect(html).toMatch(/Show all 7 days/);
  });

  it.each([
    ["null", null],
    ["zero", 0],
  ])(
    "omits the target clause when it is %s rather than inventing one",
    (_, t) => {
      const html = renderToString(
        <NextWeekSummary
          days={DAYS}
          pinned={{}}
          targetHours={t as number | null}
          availabilityHref="/train?availability=next"
        >
          <div />
        </NextWeekSummary>
      );
      expect(html).not.toContain("target");
      expect(html).not.toContain("NaN");
      // The half it CAN say honestly is still said.
      expect(html).toContain("4.5h planned");
    }
  );

  it("marks the week provisional unless every day is pinned", () => {
    const allPinned = Object.fromEntries(DAYS.map((d) => [d.date, true]));
    const loose = renderToString(
      <NextWeekSummary
        days={DAYS}
        pinned={{}}
        targetHours={9}
        availabilityHref="/train?availability=next"
      >
        <div />
      </NextWeekSummary>
    );
    const pinned = renderToString(
      <NextWeekSummary
        days={DAYS}
        pinned={allPinned}
        targetHours={9}
        availabilityHref="/train?availability=next"
      >
        <div />
      </NextWeekSummary>
    );
    expect(loose).toContain("provisional");
    expect(pinned).not.toContain("provisional");
  });

  it("has no type below the 12px floor and no ad-hoc white alphas", () => {
    const html = renderToString(
      <NextWeekSummary
        days={DAYS}
        pinned={{}}
        targetHours={9}
        availabilityHref="/train?availability=next"
      >
        <div />
      </NextWeekSummary>
    );
    expect(html).not.toMatch(/text-\[[\d.]+px\]/);
    expect(html).not.toMatch(/text-white\//);
    expect(html).not.toMatch(/bg-white\//);
  });
});
