import { describe, expect, it } from "vitest";
import { weekAheadFigures, weekAheadSentence } from "./week-ahead";
import type { DaySlot } from "./types";

function day(over: Partial<DaySlot> = {}): DaySlot {
  return {
    date: "2026-09-07",
    availableBlocks: [],
    availableMins: 0,
    workouts: [],
    status: "rest",
    ...over,
  };
}

function session(mins: number) {
  return {
    // `day` is the skeleton's own 0-6 offset. These figures never read it —
    // they count the DaySlot the session sits in — but the type requires it,
    // and vitest transpiles without checking types, so only `tsc` says so.
    day: 0,
    sport: "Run",
    type: "Endurance",
    durationMins: mins,
    intensity: "Z2",
    description: "run",
    purpose: "aerobic_base" as const,
    minEffectiveMins: mins,
    placement: { kind: "block" as const, blockIdx: 0 },
  };
}

describe("weekAheadFigures", () => {
  it("counts days with a session, not sessions", () => {
    // Two sessions on one day is one training day. The athlete reads this as
    // "how many days am I out", and MAX_SESSIONS_PER_DAY is greater than one.
    const days = [
      day({ workouts: [session(60), session(45)] }),
      day({ workouts: [session(30)] }),
      day(),
    ];
    expect(weekAheadFigures(days).sessions).toBe(2);
  });

  it("counts an open day only when there is time going spare on it", () => {
    const days = [
      day({ availableMins: 90 }), // time, nothing planned — open
      day({ availableMins: 0 }), // no time at all — not an invitation
      day({ availableMins: 90, workouts: [session(60)] }), // already used
    ];
    expect(weekAheadFigures(days).open).toBe(1);
  });

  it("sums planned minutes across every session, not every day", () => {
    const days = [day({ workouts: [session(60), session(45)] }), day()];
    expect(weekAheadFigures(days).plannedMins).toBe(105);
  });
});

describe("weekAheadSentence", () => {
  it("reads as a sentence about the week", () => {
    const days = [
      day({ workouts: [session(60)] }),
      day({ workouts: [session(30)] }),
    ];
    expect(weekAheadSentence(days, 7.1)).toBe(
      "2 sessions, 1.5h planned of a 7.1h target"
    );
  });

  it("says session, singular, when there is one", () => {
    expect(weekAheadSentence([day({ workouts: [session(60)] })], 7.1)).toBe(
      "1 session, 1.0h planned of a 7.1h target"
    );
  });

  it("omits a zero target rather than claiming one", () => {
    // "of 0h target" reads as a claim about the plan rather than as a missing
    // value — the same bound NextWeekSummary applies.
    const days = [day({ workouts: [session(60)] })];
    expect(weekAheadSentence(days, 0)).toBe("1 session, 1.0h planned");
    expect(weekAheadSentence(days, null)).toBe("1 session, 1.0h planned");
  });

  it("still describes a week with nothing on it", () => {
    // The Sunday before an empty week is exactly when the athlete needs to be
    // told, so this must not collapse to an empty string.
    expect(weekAheadSentence([day(), day()], 7.1)).toBe(
      "0 sessions, 0.0h planned of a 7.1h target"
    );
  });
});
