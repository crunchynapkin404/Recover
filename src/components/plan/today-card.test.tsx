import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { TodayCard } from "./today-card";
import type { DaySlot } from "@/lib/week-plan/types";
import { withPurpose } from "@/lib/training-plan";

const workoutSlot: DaySlot = {
  date: "2026-07-21",
  availableBlocks: [
    { start: null, end: null, mins: 60, energy: "normal", sports: null },
  ],
  availableMins: 60,
  workouts: [
    withPurpose({
      day: 1,
      sport: "Run",
      type: "Intervals",
      durationMins: 50,
      intensity: "Z4-Z5",
      description: "6×3min hard with jog recoveries",
      blockIdx: 0,
    }),
  ],
  status: "planned",
};

const restSlot: DaySlot = {
  date: "2026-07-21",
  availableBlocks: [],
  availableMins: 0,
  workouts: [],
  status: "rest",
};

describe("today card", () => {
  it("renders nothing for a null slot", () => {
    expect(
      renderToString(<TodayCard slot={null} adjustmentReason={null} />)
    ).toBe("");
  });

  it("renders workout type, duration and intensity", () => {
    const html = renderToString(
      <TodayCard slot={workoutSlot} adjustmentReason={null} />
    );
    expect(html).toContain("Intervals");
    expect(html).toContain("50 min");
    expect(html).toContain("Z4-Z5");
    expect(html).toContain("6×3min hard");
  });

  it("renders the adjustment reason verbatim when present", () => {
    const reason = "readiness red — Intervals replaced by recovery";
    const html = renderToString(
      <TodayCard slot={workoutSlot} adjustmentReason={reason} />
    );
    expect(html).toContain(reason);
  });

  it("never renders an empty explanation box when there is no reason", () => {
    const html = renderToString(
      <TodayCard slot={workoutSlot} adjustmentReason={null} />
    );
    expect(html).not.toContain("data-adjustment");
  });

  it("a rest day says Rest and shows no duration", () => {
    const html = renderToString(
      <TodayCard slot={restSlot} adjustmentReason={null} />
    );
    expect(html).toContain("Rest");
    expect(html).not.toContain("min");
  });
});
