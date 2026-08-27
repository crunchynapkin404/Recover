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

// The fixed "today" every test dates itself against, matching the week
// day-shape.test.ts already fixes: Mon 2026-08-24 .. Sun 2026-08-30.
const TODAY = "2026-08-27"; // Thursday

const longRide = slot({ date: TODAY, workouts: [w(180, "long")] });
const restDay = slot({ date: TODAY, workouts: [], status: "rest" });

describe("verdictLine", () => {
  it("names the day's session and says the athlete is ready", () => {
    const v = verdictLine({
      openDay: longRide,
      band: "green",
      readiness: 78,
      todayYmd: TODAY,
      readinessDate: TODAY,
    });
    expect(v?.text).toBe("Thursday is your long one — you're ready for it.");
    expect(v?.emphasis).toBe("you're ready for it");
  });

  it("says rest is the plan on a rest day that IS today, rather than nothing", () => {
    // readiness is green and current here on purpose: a rest day makes no
    // readiness claim regardless — there is no session to pace.
    const v = verdictLine({
      openDay: restDay,
      band: "green",
      readiness: 78,
      todayYmd: TODAY,
      readinessDate: TODAY,
    });
    expect(v?.text).toBe("Nothing planned today — that's the plan.");
    expect(v?.emphasis).toBeNull();
  });

  // Review finding 2: "Nothing planned today" is a factual error on any
  // rest day that isn't today — the open day (?day=) is usually not today.
  it("names a rest day that is NOT today, instead of calling it 'today'", () => {
    const tuesday = slot({ date: "2026-08-25", workouts: [], status: "rest" });
    const v = verdictLine({
      openDay: tuesday,
      band: "green",
      readiness: 78,
      todayYmd: TODAY,
      readinessDate: TODAY,
    });
    expect(v?.text).toBe("Tuesday is a rest day — that's the plan.");
    expect(v?.emphasis).toBeNull();
  });

  // The whole project's discipline: no claim the engine cannot support. An
  // athlete with no readiness figure gets a statement about the session and
  // NO statement about their body. Both the day and the figure are current
  // here so this test is isolated to the calibrating branch itself, not
  // entangled with the off-today/stale-figure suppression below.
  it("makes no readiness claim when readiness is calibrating", () => {
    const v = verdictLine({
      openDay: longRide,
      band: "calibrating",
      readiness: null,
      todayYmd: TODAY,
      readinessDate: TODAY,
    });
    expect(v?.text).toBe("Thursday is your long one.");
    expect(v?.emphasis).toBeNull();
  });

  // Amber and red are stated as plain facts, never dressed as encouragement
  // — "you're ready for it" is reserved for green.
  it("states amber as a fact, not encouragement", () => {
    const v = verdictLine({
      openDay: longRide,
      band: "amber",
      readiness: 45,
      todayYmd: TODAY,
      readinessDate: TODAY,
    });
    expect(v?.text).toBe(
      "Thursday is your long one — readiness is moderate today."
    );
    expect(v?.text).not.toContain("ready for it");
    expect(v?.emphasis).toBe("readiness is moderate today");
  });

  it("states red as a fact, not encouragement", () => {
    const v = verdictLine({
      openDay: longRide,
      band: "red",
      readiness: 22,
      todayYmd: TODAY,
      readinessDate: TODAY,
    });
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
      todayYmd: TODAY,
      readinessDate: TODAY,
    });
    expect(v?.text).toBe("Thursday is your long one.");
    expect(v?.emphasis).toBeNull();
  });

  // Review findings 1 & 4 (root cause): the open day (Task 4's `?day=`) is
  // usually NOT today. A readiness figure describes the athlete's body
  // right now — it must never be pinned to a day the athlete has merely
  // scrolled to.
  it("suppresses the readiness claim when the open day is not today", () => {
    const saturday = slot({
      date: "2026-08-29",
      workouts: [w(90, "threshold")],
    });
    const v = verdictLine({
      openDay: saturday,
      band: "green",
      readiness: 78,
      todayYmd: TODAY,
      readinessDate: TODAY, // the figure itself IS current — only the day isn't
    });
    expect(v?.text).toBe("Saturday is a threshold session.");
    expect(v?.emphasis).toBeNull();
  });

  // Review finding 3: readinessMetric (page.tsx) can fall back up to 7 days
  // for a non-null figure, with no staleness marker on Week the way
  // today-hero.tsx's own staleLabel warns of it. "Today" in the sentence
  // must not overstate a week-old score's currency.
  it("suppresses the readiness claim when the figure itself is stale", () => {
    const v = verdictLine({
      openDay: longRide, // the OPEN DAY is today...
      band: "green",
      readiness: 78,
      todayYmd: TODAY,
      readinessDate: "2026-08-20", // ...but the figure is a week old
    });
    expect(v?.text).toBe("Thursday is your long one.");
    expect(v?.emphasis).toBeNull();
  });

  // Review finding 4: a day already completed or missed is not described
  // as if it were still ahead.
  it("describes a completed day in the past tense, and makes no claim off-today", () => {
    const monday = slot({
      date: "2026-08-24",
      workouts: [w(180, "long")],
      status: "completed",
    });
    const v = verdictLine({
      openDay: monday,
      band: "green",
      readiness: 78,
      todayYmd: TODAY,
      readinessDate: TODAY,
    });
    expect(v?.text).toBe("Monday was your long one.");
    expect(v?.emphasis).toBeNull();
  });

  it("describes a missed day in the past tense", () => {
    const monday = slot({
      date: "2026-08-24",
      workouts: [w(60, "threshold")],
      status: "missed",
    });
    const v = verdictLine({
      openDay: monday,
      band: "calibrating",
      readiness: null,
      todayYmd: TODAY,
      readinessDate: null,
    });
    expect(v?.text).toBe("Monday was a threshold session.");
  });

  // materializeWeek always empties `workouts` on a race day — status is the
  // only way to tell "nothing planned" apart from "the plan is a race
  // today", so a race day must never read as a rest day. Both `text` and
  // `emphasis` are asserted: the clause is a deliberate claim, not an
  // accident of string matching.
  it("calls a race day what it is, not a rest day", () => {
    const raceDay = slot({
      workouts: [],
      status: "race",
      raceName: "Alpine Gran Fondo",
    });
    const v = verdictLine({
      openDay: raceDay,
      band: "green",
      readiness: 78,
      todayYmd: TODAY,
      readinessDate: TODAY,
    });
    expect(v?.text).toBe("Thursday is race day — you're ready for it.");
    expect(v?.emphasis).toBe("you're ready for it");
  });

  // Review: the race check must be structural (status checked first), not
  // merely correct by coincidence of race days always carrying zero
  // workouts. A race day that somehow carries a workout must still read as
  // race day.
  it("reads a race day as race day even if it somehow carries a workout", () => {
    const raceWithWorkout = slot({
      workouts: [w(60, "aerobic_base")],
      status: "race",
      raceName: "Alpine Gran Fondo",
    });
    const v = verdictLine({
      openDay: raceWithWorkout,
      band: "calibrating",
      readiness: null,
      todayYmd: TODAY,
      readinessDate: null,
    });
    expect(v?.text).toBe("Thursday is race day.");
  });

  // Up to MAX_SESSIONS_PER_DAY (2) sessions can land on one day — the
  // sentence must not pretend it is only one of them. Given a real band
  // (not "calibrating", which the mutation check below needs isolated to
  // tests actually about it) so this pins its own claim independently.
  it("counts multiple sessions rather than naming just one", () => {
    const twoADay = slot({
      workouts: [w(60, "aerobic_base"), w(30, "strength")],
    });
    const v = verdictLine({
      openDay: twoADay,
      band: "amber",
      readiness: 50,
      todayYmd: TODAY,
      readinessDate: TODAY,
    });
    expect(v?.text).toBe(
      "Thursday is 2 sessions — readiness is moderate today."
    );
    expect(v?.emphasis).toBe("readiness is moderate today");
  });

  it("names a threshold session", () => {
    const v = verdictLine({
      openDay: slot({ workouts: [w(60, "threshold")] }),
      band: "red",
      readiness: 20,
      todayYmd: TODAY,
      readinessDate: TODAY,
    });
    expect(v?.text).toBe(
      "Thursday is a threshold session — readiness is low today."
    );
    expect(v?.emphasis).toBe("readiness is low today");
  });
});
