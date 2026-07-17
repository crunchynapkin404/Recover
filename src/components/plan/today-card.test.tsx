import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { TodayCard } from "./today-card";
import type { DaySlot } from "@/lib/week-plan/types";

const workoutSlot: DaySlot = {
  date: "2026-07-21",
  availableMins: 60,
  workout: {
    day: 1,
    sport: "Run",
    type: "Intervals",
    durationMins: 50,
    intensity: "Z4-Z5",
    description: "6×3min hard with jog recoveries",
  },
  status: "planned",
};

const restSlot: DaySlot = {
  date: "2026-07-21",
  availableMins: 0,
  workout: null,
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
