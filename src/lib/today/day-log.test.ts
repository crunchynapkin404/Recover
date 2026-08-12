import { describe, expect, it } from "vitest";
import { debriefLineFor, type DebriefCandidate } from "./day-log";

// No "Z" suffix, matching how the app's own connectors build startDateLocal
// (see connectors/intervals.ts: `new Date(row.start_date_local)` on a
// Z-less string) — the JS Date constructor parses that as local time in the
// process's own TZ, which is what makes localYmd()'s local getters read the
// athlete's real wall-clock day back out. A "Z"-suffixed string here would
// test a shape these fields are never actually built from.
function activity(overrides: Partial<DebriefCandidate> = {}): DebriefCandidate {
  return {
    debriefState: "answered",
    name: "Endurance Spin",
    sport: "Ride",
    perceivedExertion: 6,
    feel: "normal",
    startDate: new Date("2026-08-12T06:00:00"),
    startDateLocal: new Date("2026-08-12T08:00:00"),
    ...overrides,
  };
}

describe("debriefLineFor", () => {
  it("renders the name, RPE and feel for today's own debriefed activity", () => {
    expect(debriefLineFor(activity(), "2026-08-12")).toBe(
      "Endurance Spin — RPE 6 · felt normal"
    );
  });

  // C4, whole-branch review 2026-08-12: recentActivity's window spans
  // midnight on purpose (a ride ending 23:30 still leads "post-session" at
  // 00:15), so it alone cannot say "today". An activity from yesterday
  // evening, still debriefed and still inside that window, must not be
  // read as today's log.
  it("returns null for a debriefed activity from a day that isn't today", () => {
    expect(
      debriefLineFor(
        activity({
          startDate: new Date("2026-08-11T20:00:00"),
          startDateLocal: new Date("2026-08-11T22:00:00"),
        }),
        "2026-08-12"
      )
    ).toBeNull();
  });

  it("prefers startDateLocal over startDate when they land on different days", () => {
    // startDate (the true UTC instant) is still 2026-08-11 evening, but the
    // athlete's own wall clock (startDateLocal) already reads past midnight
    // into 2026-08-12 — the day this function must trust.
    expect(
      debriefLineFor(
        activity({
          startDate: new Date("2026-08-11T23:30:00"),
          startDateLocal: new Date("2026-08-12T01:30:00"),
        }),
        "2026-08-12"
      )
    ).toBe("Endurance Spin — RPE 6 · felt normal");
  });

  it("falls back to startDate when startDateLocal is null", () => {
    expect(
      debriefLineFor(
        activity({
          startDateLocal: null,
          startDate: new Date("2026-08-12T06:00:00"),
        }),
        "2026-08-12"
      )
    ).toBe("Endurance Spin — RPE 6 · felt normal");
  });

  it("returns null when the activity has not been debriefed", () => {
    expect(
      debriefLineFor(activity({ debriefState: "pending" }), "2026-08-12")
    ).toBeNull();
    expect(
      debriefLineFor(activity({ debriefState: null }), "2026-08-12")
    ).toBeNull();
  });

  it("returns null for no activity at all", () => {
    expect(debriefLineFor(null, "2026-08-12")).toBeNull();
    expect(debriefLineFor(undefined, "2026-08-12")).toBeNull();
  });

  it("falls back to sport when the activity has no name", () => {
    expect(debriefLineFor(activity({ name: null }), "2026-08-12")).toBe(
      "Ride — RPE 6 · felt normal"
    );
  });

  it("omits the RPE/feel clause entirely when neither is set", () => {
    expect(
      debriefLineFor(
        activity({ perceivedExertion: null, feel: null }),
        "2026-08-12"
      )
    ).toBe("Endurance Spin");
  });
});
