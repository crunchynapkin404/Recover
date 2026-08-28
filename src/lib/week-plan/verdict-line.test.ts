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

  // types.ts:44-64 — `restIntent` is the ONLY marker for a day the engine
  // deliberately left empty. `status: "rest"` alone cannot mean this
  // (materializeWeek starts every day there, and the drop/move rungs
  // restamp a day "rest" too — see the two tests below this one).
  it("says rest is the plan on a deliberately-empty day that IS today", () => {
    const preRaceToday = slot({
      date: TODAY,
      workouts: [],
      status: "rest",
      restIntent: "pre_race",
    });
    // readiness is green and current here on purpose: an empty day makes
    // no readiness claim regardless — there is no session to pace.
    const v = verdictLine({
      openDay: preRaceToday,
      band: "green",
      readiness: 78,
      todayYmd: TODAY,
      readinessDate: TODAY,
    });
    expect(v?.text).toBe("Nothing planned today — that's the plan.");
    expect(v?.emphasis).toBeNull();
  });

  it("names a deliberately-empty day that is NOT today, instead of calling it 'today'", () => {
    const preRaceTuesday = slot({
      date: "2026-08-25",
      workouts: [],
      status: "rest",
      restIntent: "pre_race",
    });
    const v = verdictLine({
      openDay: preRaceTuesday,
      band: "green",
      readiness: 78,
      todayYmd: TODAY,
      readinessDate: TODAY,
    });
    expect(v?.text).toBe("Tuesday is a rest day — that's the plan.");
    expect(v?.emphasis).toBeNull();
  });

  // Review breakage 2: service.ts's drop/move rung (moveWorkout,
  // ~line 840) stamps a day back to `status: "rest"` with NO `restIntent`
  // when its last session leaves — types.ts says outright that such a day
  // is precisely NOT deliberate rest. It must not read "that's the plan".
  it("says nothing is planned, without claiming it, on a day emptied by a drop or move", () => {
    const droppedToday = slot({ date: TODAY, workouts: [], status: "rest" });
    const v = verdictLine({
      openDay: droppedToday,
      band: "green",
      readiness: 78,
      todayYmd: TODAY,
      readinessDate: TODAY,
    });
    expect(v?.text).toBe("Nothing planned today.");
    expect(v?.emphasis).toBeNull();
  });

  it("names a non-today day emptied by a drop or move, without claiming it's the plan", () => {
    const droppedTuesday = slot({
      date: "2026-08-25",
      workouts: [],
      status: "rest",
    });
    const v = verdictLine({
      openDay: droppedTuesday,
      band: "green",
      readiness: 78,
      todayYmd: TODAY,
      readinessDate: TODAY,
    });
    expect(v?.text).toBe("Nothing planned for Tuesday.");
    expect(v?.emphasis).toBeNull();
  });

  // Review breakage 1: adapt-day.ts's handleMissedYesterday empties
  // `workouts` in the SAME stamp that sets `status: "missed"` — a missed
  // day can never carry workouts in production, so this fixture matches
  // what the engine actually writes (the prior version of this test built
  // a status/workouts combination production cannot produce). Must not
  // read as rest (the athlete didn't choose this) and must not claim
  // nothing happened (Recover tracks `unplannedLoad` separately for
  // exactly that reason).
  //
  // Task 6b: "planned SESSION was missed" said singular, but
  // handleMissedYesterday snapshots and moves/drops EVERY session on the
  // day before wiping it — a two-session day misses both sessions (see
  // the two-session test right below) — and that count is discarded by
  // the same stamp this fixture matches: `workouts` is always `[]` here,
  // whether one session or two were actually lost, so this branch has no
  // number left to pluralise correctly even if it tried. "plan" is
  // count-neutral and honest either way.
  it("says a plan was missed, not that the day was rest", () => {
    const missedMonday = slot({
      date: "2026-08-24",
      workouts: [],
      status: "missed",
    });
    const v = verdictLine({
      openDay: missedMonday,
      band: "green",
      readiness: 78,
      todayYmd: TODAY,
      readinessDate: TODAY,
    });
    expect(v?.text).toBe("Monday's plan was missed.");
    expect(v?.text).not.toContain("rest");
    expect(v?.text).not.toContain("session");
    expect(v?.emphasis).toBeNull();
  });

  // A two-session missed day (adapt-day.ts:87-90's own example — "A
  // two-session day misses both sessions") reaches verdictLine as the
  // EXACT SAME shape as a one-session miss: handleMissedYesterday snapshots
  // both sessions for its own move/drop bookkeeping, then wipes `workouts`
  // to `[]` in the same stamp that sets `status: "missed"`, so no session
  // count ever survives into the DaySlot this function reads. This test
  // exists to make that explicit rather than leaving it implicit in the
  // single fixture above: the count-neutral "plan was missed" is correct
  // for both a one- and a two-session day, by construction, not by luck.
  it("reads identically for a day that lost two sessions — the count never survives to this function", () => {
    const missedTwoSessionMonday = slot({
      date: "2026-08-24",
      workouts: [], // what a 2-session miss ALSO collapses to — see above.
      status: "missed",
    });
    const v = verdictLine({
      openDay: missedTwoSessionMonday,
      band: "green",
      readiness: 78,
      todayYmd: TODAY,
      readinessDate: TODAY,
    });
    expect(v?.text).toBe("Monday's plan was missed.");
    expect(v?.text).not.toContain("session");
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

  // Review finding 4: a day already completed is not described as if it
  // were still ahead.
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

  // I4, this fix wave: the case the test above masks. That one's day is
  // genuinely in the past (2026-08-24 < TODAY), so `isPast` reads true off
  // the date alone and the status never gets exercised. Here the athlete
  // has marked TODAY's ride done (mark-done-button.tsx → markDayDone →
  // service.ts stamps "completed" same-day) — `openDay.date === todayYmd`,
  // so a pure date comparison says `isPast === false` even though the
  // session is over. Both halves matter: the tense must say "was" (not
  // "is", which is simply wrong), AND no readiness claim may attach (a
  // "you're ready for it" about a ride already finished is not a grammar
  // slip, it's a false claim about the athlete's body).
  it("describes TODAY's already-completed day in the past tense, with no readiness claim", () => {
    const finishedToday = slot({
      date: TODAY,
      workouts: [w(180, "long")],
      status: "completed",
    });
    const v = verdictLine({
      openDay: finishedToday,
      band: "green",
      readiness: 78,
      todayYmd: TODAY,
      readinessDate: TODAY,
    });
    expect(v?.text).toBe("Thursday was your long one.");
    expect(v?.emphasis).toBeNull();
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
  // M3, final whole-branch review: "Thursday is 2 sessions" reads as an
  // equation ("Thursday equals two sessions"), not a schedule. "has" is
  // the verb a count of sessions actually takes.
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
      "Thursday has 2 sessions — readiness is moderate today."
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

  // I3, final whole-branch review: `isPast` used to be
  // `status === "completed" || "missed"`. A race day's status is always
  // "race" — never "completed" or "missed" — so a past race kept reading
  // in the present tense forever. Tense must come from the date.
  it("reads a past race day in the past tense", () => {
    const pastRace = slot({
      date: "2026-08-22", // the Saturday before TODAY (2026-08-27, Thursday)
      workouts: [],
      status: "race",
      raceName: "Club Crit",
    });
    const v = verdictLine({
      openDay: pastRace,
      band: "green",
      readiness: 78,
      todayYmd: TODAY,
      readinessDate: TODAY,
    });
    expect(v?.text).toBe("Saturday was race day.");
    expect(v?.emphasis).toBeNull();
  });

  // I3: the other half of the same root cause. adapt-day.ts's
  // handleMissedYesterday only ever looks at yesterday, so a day three
  // days gone can still carry `status: "planned"` — never "completed" —
  // forever. No test before this one covered a past day whose status is
  // neither "completed" nor "missed".
  it("describes a past day in the past tense even when nothing ever stamped it completed or missed", () => {
    const staleMonday = slot({
      date: "2026-08-24", // Monday, three days before TODAY — status
      workouts: [w(180, "long")], // untouched: still "planned", not "completed"
      status: "planned",
    });
    const v = verdictLine({
      openDay: staleMonday,
      band: "green",
      readiness: 78,
      todayYmd: TODAY,
      readinessDate: TODAY,
    });
    expect(v?.text).toBe("Monday was your long one.");
    expect(v?.emphasis).toBeNull();
  });

  // I3 + M3 together: a past day with more than one session takes "had",
  // not "has" — the same count-noun fix as the present-tense case above,
  // in the tense a genuinely past day actually needs.
  it("reads a past multi-session day with 'had', not 'has'", () => {
    const pastTwoADay = slot({
      date: "2026-08-24",
      workouts: [w(60, "aerobic_base"), w(30, "strength")],
      status: "planned",
    });
    const v = verdictLine({
      openDay: pastTwoADay,
      band: "green",
      readiness: 78,
      todayYmd: TODAY,
      readinessDate: TODAY,
    });
    expect(v?.text).toBe("Monday had 2 sessions.");
    expect(v?.emphasis).toBeNull();
  });
});
