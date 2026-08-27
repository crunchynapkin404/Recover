import { describe, expect, it } from "vitest";
import { verdictLine } from "./verdict-line";
import type { DaySlot, ScheduledWorkout } from "./types";

// Same local-fixture convention as day-shape.test.ts (this suite's sibling):
// no shared test util, a `slot`/`w` pair per file.
const slot = (over: Partial<DaySlot> = {}): DaySlot => ({
  date: "2026-08-27", // a Thursday
  availableBlocks: [],
  workouts: [],
  availableMins: 0,
  status: "planned",
  ...over,
});

const w = (durationMins: number, purpose: string) =>
  ({
    durationMins,
    purpose,
    day: 3,
    sport: "Ride",
    type: "Long",
    intensity: "Z1-Z2",
    description: "",
    minEffectiveMins: 90,
    blockIdx: 0,
  }) as unknown as ScheduledWorkout;

const longRide = slot({ workouts: [w(180, "long")] });
const restDay = slot({ workouts: [] });

describe("verdictLine", () => {
  it("names the day's session and says the athlete is ready", () => {
    const v = verdictLine({ openDay: longRide, band: "green", readiness: 78 });
    expect(v?.text).toBe("Thursday is your long one — you're ready for it.");
    expect(v?.emphasis).toBe("you're ready for it");
  });

  it("says rest is the plan on a rest day, rather than nothing", () => {
    // readiness is green here on purpose: a rest day makes no readiness
    // claim regardless of the band — there is no session to pace.
    const v = verdictLine({ openDay: restDay, band: "green", readiness: 78 });
    expect(v?.text).toBe("Nothing planned today — that's the plan.");
    expect(v?.emphasis).toBeNull();
  });

  // The whole project's discipline: no claim the engine cannot support. An
  // athlete with no readiness figure gets a statement about the session and
  // NO statement about their body.
  it("makes no readiness claim when readiness is calibrating", () => {
    const v = verdictLine({
      openDay: longRide,
      band: "calibrating",
      readiness: null,
    });
    expect(v?.text).toBe("Thursday is your long one.");
    expect(v?.emphasis).toBeNull();
  });

  // Amber and red are stated as plain facts, never dressed as encouragement
  // — "you're ready for it" is reserved for green.
  it("states amber as a fact, not encouragement", () => {
    const v = verdictLine({ openDay: longRide, band: "amber", readiness: 45 });
    expect(v?.text).toBe(
      "Thursday is your long one — readiness is moderate today."
    );
    expect(v?.text).not.toContain("ready for it");
    expect(v?.emphasis).toBe("readiness is moderate today");
  });

  it("states red as a fact, not encouragement", () => {
    const v = verdictLine({ openDay: longRide, band: "red", readiness: 22 });
    expect(v?.text).toBe("Thursday is your long one — readiness is low today.");
    expect(v?.text).not.toContain("ready for it");
    expect(v?.emphasis).toBe("readiness is low today");
  });

  // A stored row can claim a band with no number behind it (a data
  // inconsistency, not a state computeReadiness itself ever produces) — the
  // module refuses the claim rather than printing a confident sentence with
  // nothing under it.
  it("makes no readiness claim when the band and figure disagree", () => {
    const v = verdictLine({
      openDay: longRide,
      band: "green",
      readiness: null,
    });
    expect(v?.text).toBe("Thursday is your long one.");
    expect(v?.emphasis).toBeNull();
  });

  // materializeWeek always empties `workouts` on a race day — status is the
  // only way to tell "nothing planned" apart from "the plan is a race
  // today", so a race day must never read as a rest day.
  it("calls a race day what it is, not a rest day", () => {
    const raceDay = slot({
      workouts: [],
      status: "race",
      raceName: "Alpine Gran Fondo",
    });
    const v = verdictLine({ openDay: raceDay, band: "green", readiness: 78 });
    expect(v?.text).toBe("Thursday is race day — you're ready for it.");
  });

  // Up to MAX_SESSIONS_PER_DAY (2) sessions can land on one day — the
  // sentence must not pretend it is only one of them.
  it("counts multiple sessions rather than naming just one", () => {
    const twoADay = slot({
      workouts: [w(60, "aerobic_base"), w(30, "strength")],
    });
    const v = verdictLine({
      openDay: twoADay,
      band: "calibrating",
      readiness: null,
    });
    expect(v?.text).toBe("Thursday is 2 sessions.");
  });

  it("names a threshold session", () => {
    const v = verdictLine({
      openDay: slot({ workouts: [w(60, "threshold")] }),
      band: "calibrating",
      readiness: null,
    });
    expect(v?.text).toBe("Thursday is a threshold session.");
  });
});
