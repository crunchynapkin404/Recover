import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { WeekDayList } from "./week-day-list";
import type { DaySlot } from "@/lib/week-plan/types";
import { withPurpose } from "@/lib/training-plan";
import { workoutForDay } from "@/lib/interval/for-day";
import { blockPlacement } from "@/lib/week-plan/placement";

function localYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const TODAY = localYmd(new Date());
const TOMORROW = localYmd(new Date(Date.now() + 86_400_000));
const YESTERDAY = localYmd(new Date(Date.now() - 86_400_000));

const tempo: DaySlot["workouts"][number] = withPurpose({
  day: 0,
  sport: "Ride",
  type: "Tempo",
  durationMins: 75,
  intensity: "2×20",
  description: "Sweet spot",
  placement: blockPlacement(0),
});

const strengthSession: DaySlot["workouts"][number] = withPurpose({
  day: 0,
  sport: "Strength",
  type: "Strength",
  durationMins: 45,
  intensity: "4x8",
  description: "Squat 4x8 @ 130kg · Bench 4x8 @ 65kg",
  placement: blockPlacement(0),
  exercises: [
    {
      lift: "Squat",
      sets: 4,
      reps: 8,
      pctOneRm: 0.65,
      targetLoadKg: 130,
    },
  ],
});

const slot = (
  date: string,
  status: DaySlot["status"],
  workout: DaySlot["workouts"][number] | null = null,
  extra: Partial<DaySlot> = {}
): DaySlot => ({
  date,
  availableBlocks: [
    { start: null, end: null, mins: 90, energy: "normal", sports: null },
  ],
  availableMins: 90,
  workouts: workout ? [workout] : [],
  status,
  ...extra,
});

// Fixed fixture for the rolling-week tests below: 2026-07-28 is a Tuesday
// (today), 2026-08-04 is the Tuesday of the week that follows it.
const CURRENT_WEEK_DAYS: DaySlot[] = [
  slot("2026-07-27", "completed", tempo), // Mon
  slot("2026-07-28", "completed", tempo), // Tue — today
  slot("2026-07-29", "planned", tempo), // Wed
  slot("2026-07-30", "planned", tempo), // Thu
  slot("2026-07-31", "planned", tempo), // Fri
  slot("2026-08-01", "rest"), // Sat
  slot("2026-08-02", "rest"), // Sun
];

const NEXT_WEEK_DAYS: DaySlot[] = [
  slot("2026-08-03", "planned", tempo), // Mon
  slot("2026-08-04", "planned", tempo), // Tue
  slot("2026-08-05", "planned", tempo), // Wed
  slot("2026-08-06", "planned", tempo), // Thu
  slot("2026-08-07", "planned", tempo), // Fri
  slot("2026-08-08", "rest"), // Sat
  slot("2026-08-09", "rest"), // Sun
];

describe("WeekDayList — the Add a ride link", () => {
  // The ONLY entry point to the athlete-chosen-workout picker, and it was
  // shipped with no test and no capture: the soak fixture's open day always
  // holds a session, so the link never renders in any photograph. If it were
  // wrong the whole feature would be unreachable and nothing would say so.
  const REST_DAYS: DaySlot[] = [slot("2026-08-01", "rest")];

  it("renders on an empty open day when the page offers an href", () => {
    const html = renderToString(
      <WeekDayList
        days={REST_DAYS}
        today="2026-08-01"
        openDate="2026-08-01"
        addRideHref={{ "2026-08-01": "/train?sheet=pick-workout&day=2026-08-01" }}
      />
    );
    expect(html).toContain("Add a ride");
    expect(html).toContain("/train?sheet=pick-workout&amp;day=2026-08-01");
  });

  it("does not render when the page offers no href for that day", () => {
    // The page builds the map from canAddWorkout, so an absent date IS the
    // refusal — settled, full and past days simply never appear in it.
    const html = renderToString(
      <WeekDayList
        days={REST_DAYS}
        today="2026-08-01"
        openDate="2026-08-01"
        addRideHref={{}}
      />
    );
    expect(html).not.toContain("Add a ride");
  });

  it("does not render when the prop is absent entirely", () => {
    const html = renderToString(
      <WeekDayList days={REST_DAYS} today="2026-08-01" openDate="2026-08-01" />
    );
    expect(html).not.toContain("Add a ride");
  });

  it("does not render on a day that already holds a session", () => {
    // A day with a workout renders its session row, not the Rest line the
    // link lives on — this is what the soak fixture exercises, and why the
    // link was invisible to every capture.
    const html = renderToString(
      <WeekDayList
        days={[slot("2026-08-01", "planned", tempo)]}
        today="2026-08-01"
        openDate="2026-08-01"
        addRideHref={{ "2026-08-01": "/train?sheet=pick-workout&day=2026-08-01" }}
      />
    );
    expect(html).not.toContain("Add a ride");
  });

  it("keeps the Rest line's free-minutes reading alongside the link", () => {
    const html = renderToString(
      <WeekDayList
        days={REST_DAYS}
        today="2026-08-01"
        openDate="2026-08-01"
        addRideHref={{ "2026-08-01": "/train?sheet=pick-workout&day=2026-08-01" }}
      />
    );
    expect(html).toContain("Rest");
    expect(html).toContain("min free");
  });
});

describe("WeekDayList", () => {
  it("renders the open day's row with its workout, intensity and status", () => {
    const html = renderToString(
      <WeekDayList
        today={TODAY}
        openDate={TODAY}
        days={[slot(TODAY, "completed", tempo)]}
      />
    );
    expect(html).toContain("Tempo");
    expect(html).toContain("75 min");
    expect(html).toContain("2×20");
    // Status is a dot (data-status, matching week-strip.tsx) with an
    // sr-only label, not a printed pill — see the v0.99 slice 2 describe
    // block below for the dedicated coverage of that rendering.
    expect(html).toContain('data-status="completed"');
    expect(html).toContain('<span class="sr-only">Completed</span>');
  });

  it("renders only the open day — Task 4 collapses seven rows to one", () => {
    const html = renderToString(
      <WeekDayList
        today={TODAY}
        openDate={TODAY}
        days={[
          slot(TODAY, "completed", tempo),
          slot(TOMORROW, "planned", tempo),
        ]}
      />
    );
    expect(html).toContain(`data-date="${TODAY}"`);
    expect(html).not.toContain(`data-date="${TOMORROW}"`);
    expect((html.match(/data-date="/g) ?? []).length).toBe(1);
  });

  it("gives the open day today's row treatment even when it isn't literally today", () => {
    // The day strip (Task 3) can open ANY day of the week, via ?day=. The
    // highlight and DayActions used to be exclusive to isToday; now they
    // belong to whichever day is open, or browsing to Wednesday would
    // silently lose both.
    const html = renderToString(
      <WeekDayList
        today={TODAY}
        openDate={TOMORROW}
        days={[slot(TODAY, "rest"), slot(TOMORROW, "planned", tempo)]}
      />
    );
    expect(html).toContain(`data-date="${TOMORROW}"`);
    expect(html).not.toContain(`data-date="${TODAY}"`);
    expect(html).toContain("bg-surface-overlay");
    // DayActions mounted — its own "Plan change" select is the marker.
    expect(html).toContain('aria-label="Plan change"');
  });

  it("shows free minutes on a rest day instead of inventing a session", () => {
    const html = renderToString(
      <WeekDayList
        today={TODAY}
        openDate={TOMORROW}
        days={[slot(TOMORROW, "rest")]}
      />
    );
    expect(html).toContain("Rest");
    expect(html).toContain("90 min free");
  });

  it("credits training done on a day the plan left empty", () => {
    // A rest day the athlete actually rode looked identical to one they
    // spent on the couch: the agenda renders planned workouts, and an
    // unplanned ride is by definition not one. Reported 2026-07-30 — two
    // rides that day, and today's row still read "Rest · 120 min free".
    const html = renderToString(
      <WeekDayList
        today={TODAY}
        openDate={TODAY}
        days={[slot(TODAY, "rest")]}
        actuals={{
          [TODAY]: { count: 2, secs: 5823, load: 130, activityId: "act-1" },
        }}
      />
    );
    expect(html).toContain("Rest");
    expect(html).toContain("2 sessions");
    expect(html).toContain("1:37");
    expect(html).toContain("130 load");
  });

  it("says a single session in the singular", () => {
    const html = renderToString(
      <WeekDayList
        today={TODAY}
        openDate={TODAY}
        days={[slot(TODAY, "rest")]}
        actuals={{
          [TODAY]: { count: 1, secs: 3039, load: 63, activityId: "act-1" },
        }}
      />
    );
    expect(html).toContain("1 session");
    expect(html).not.toContain("1 sessions");
  });

  it("leaves a planned day's row alone — the sub-line is for days the plan left empty", () => {
    // A completed planned session already reads as "completed" via its own
    // status chip; repeating the same ride underneath it would be the
    // duplicate-data problem this project keeps having to undo.
    const html = renderToString(
      <WeekDayList
        today={TODAY}
        openDate={TODAY}
        days={[slot(TODAY, "completed", tempo)]}
        actuals={{
          [TODAY]: { count: 1, secs: 3039, load: 63, activityId: "act-1" },
        }}
      />
    );
    expect(html).not.toContain("1 session");
  });

  it("shows nothing extra on a rest day with no training", () => {
    const html = renderToString(
      <WeekDayList
        today={TODAY}
        openDate={TODAY}
        days={[slot(TODAY, "rest")]}
        actuals={{}}
      />
    );
    expect(html).toContain("Rest");
    expect(html).not.toContain("session");
  });

  it("shows the lifts and loads on a strength day", () => {
    const html = renderToString(
      <WeekDayList
        today={TODAY}
        openDate={TODAY}
        days={[slot(TODAY, "planned", strengthSession)]}
      />
    );
    expect(html).toContain("Squat 4x8 @ 130kg");
  });

  it("shows sets and reps for a lift with no weight target", () => {
    const noWeight: DaySlot["workouts"][number] = withPurpose({
      day: 0,
      sport: "Strength",
      type: "Strength",
      durationMins: 45,
      intensity: "4x8",
      description: "Squat 4x8",
      placement: blockPlacement(0),
      exercises: [
        {
          lift: "Squat",
          sets: 4,
          reps: 8,
          pctOneRm: 0.65,
          targetLoadKg: null,
        },
      ],
    });
    const html = renderToString(
      <WeekDayList
        today={TODAY}
        openDate={TODAY}
        days={[slot(TODAY, "planned", noWeight)]}
      />
    );
    expect(html).toContain("Squat 4x8");
    expect(html).not.toMatch(/@ NaN|@ nullkg/);
  });

  it("names the race rather than the workout on a race day", () => {
    const html = renderToString(
      <WeekDayList
        today={TODAY}
        openDate={TOMORROW}
        days={[slot(TOMORROW, "race", null, { raceName: "Gran Fondo" })]}
      />
    );
    expect(html).toContain("Gran Fondo");
  });

  it("credits a moved session with the weekday it came from", () => {
    const html = renderToString(
      <WeekDayList
        today={TODAY}
        openDate={TODAY}
        days={[slot(TODAY, "moved", tempo, { movedFrom: YESTERDAY })]}
      />
    );
    const from = new Date(YESTERDAY + "T00:00:00").toLocaleDateString("en-US", {
      weekday: "short",
    });
    expect(html).toContain(`moved from ${from}`);
  });

  it("excludes a dropped past day from the open day's move/swap targets", () => {
    // A rest day before today must not leak back in as a selectable
    // DayActions "Target day" option for the open row — DayActions itself
    // only filters by workoutCount/isRace, trusting the caller for "target
    // days are always inside the open week" (its own comment).
    const html = renderToString(
      <WeekDayList
        today="2026-07-28"
        openDate="2026-07-28"
        days={[
          // Mon, dropped, no workout — would otherwise pass DayActions'
          // own "move" target filter and show up in the dropdown.
          slot("2026-07-27", "rest"),
          slot("2026-07-28", "planned", tempo), // Tue — today, open
        ]}
      />
    );
    expect(html).not.toContain("2026-07-27");
  });

  it("renders only the open day from the current week — nothing else, past or future", () => {
    const html = renderToString(
      <WeekDayList
        days={CURRENT_WEEK_DAYS} // Mon..Sun, Mon+Tue completed, today = Tue
        today="2026-07-28"
        openDate="2026-07-28"
        nextWeek={null}
      />
    );
    for (const d of CURRENT_WEEK_DAYS) {
      if (d.date === "2026-07-28") continue;
      expect(html).not.toContain(`data-date="${d.date}"`);
    }
    expect(html).toContain('data-date="2026-07-28"');
  });

  it("shows next week under a boundary, collapsed into a summary that still holds the rows", () => {
    const html = renderToString(
      <WeekDayList
        days={CURRENT_WEEK_DAYS}
        today="2026-07-28"
        openDate="2026-07-28"
        nextWeek={{
          days: NEXT_WEEK_DAYS,
          pinned: {},
          targetHours: 13,
          availabilityHref: "/train?availability=next",
        }}
      />
    );
    expect(html).toContain("Next week");
    // The summary line, not seven expanded rows, is what sits right after
    // the boundary now — collapsed behind a closed <details> (Task 4).
    expect(html).toContain("<details");
    expect(html).not.toContain("<details open");
    expect(html).toMatch(/Show all 7 days/);
    // The seven day rows are still in the DOM, between the boundary and the
    // end of the section — collapsing must never make them unreachable.
    expect(html).toContain("provisional");
    for (const d of NEXT_WEEK_DAYS) {
      expect(html).toContain(`data-date="${d.date}"`);
    }
    // End-to-end: the fixture's targetHours (13, chosen so it cannot
    // collide with a date digit or another rendered count) must reach
    // NextWeekSummary's rendered target clause through week-day-list.tsx's
    // own plumbing, not just through NextWeekSummary's own unit test, which
    // hardcodes its prop and so cannot catch a value-level wiring bug here.
    expect(html).toContain("13h target");
  });

  it("does not mark a pinned day provisional", () => {
    const html = renderToString(
      <WeekDayList
        days={CURRENT_WEEK_DAYS}
        today="2026-07-28"
        openDate="2026-07-28"
        nextWeek={{
          days: NEXT_WEEK_DAYS,
          pinned: { "2026-08-04": true },
          targetHours: 9,
          availabilityHref: "/train?availability=next",
        }}
      />
    );
    // The pinned day's row must not carry the provisional marker.
    expect(html).toContain("pinned");

    // Isolate the pinned day's own row from the rest of the page — a
    // page-level "provisional" caption or a badge on a sibling row would
    // make a bare `toContain("provisional")` pass regardless of whether
    // THIS row is exempt, which is the behaviour under test.
    const rowsByDate = html.split('data-date="').slice(1);
    const pinnedRow = rowsByDate.find((r) => r.startsWith("2026-08-04"));
    expect(pinnedRow).toBeDefined();
    expect(pinnedRow).toContain("pinned");
    expect(pinnedRow).not.toContain("provisional");
  });

  it("says so when next week has no availability at all", () => {
    // Spec edge case: every day rest, rather than an empty box the athlete
    // cannot interpret. Silence here reads as a bug, which is the whole
    // failure mode this feature exists to remove.
    const allRest = NEXT_WEEK_DAYS.map((d) => ({
      ...d,
      workouts: [],
      availableBlocks: [],
      availableMins: 0,
      status: "rest" as const,
    }));
    const html = renderToString(
      <WeekDayList
        days={CURRENT_WEEK_DAYS}
        today="2026-07-28"
        openDate="2026-07-28"
        nextWeek={{
          days: allRest,
          pinned: {},
          targetHours: null,
          availabilityHref: "/train?availability=next",
        }}
      />
    );
    expect(html).toContain("No availability set for next week");
    // No summary and no disclosure when there's nothing to preview.
    expect(html).not.toContain("<details");
    // Finding 1 regression: this is the ONE state where the link matters
    // most — the athlete has nothing set yet and needs a way to fix that.
    // The sweep moved the link inside NextWeekSummary, which only renders
    // in the OTHER (has-availability) branch, leaving this one a dead end.
    expect(html).toContain('href="/train?availability=next"');
    expect(html).toMatch(/Set next week/);
  });
});

describe("WeekDayList — status as a dot, not a pill (v0.99 slice 2)", () => {
  it("names the status for assistive tech without printing it as a pill", () => {
    // Only one row renders per call now (Task 4), so the completed and
    // planned statuses are checked across two separate opens of the same
    // week rather than in one render of every day.
    const completedHtml = renderToString(
      <WeekDayList
        days={CURRENT_WEEK_DAYS}
        today="2026-07-28"
        openDate="2026-07-28"
      />
    );
    // The dot carries the status in the DOM the way week-strip does.
    expect(completedHtml).toContain('data-status="completed"');
    // …and names it for a screen reader.
    expect(completedHtml).toMatch(/<span class="sr-only">Completed<\/span>/i);
    // But the uppercase text pill is gone: no visible bare status word.
    expect(completedHtml).not.toMatch(/uppercase[^"]*">\s*completed/i);

    const plannedHtml = renderToString(
      <WeekDayList
        days={CURRENT_WEEK_DAYS}
        today="2026-07-28"
        openDate="2026-07-29"
      />
    );
    expect(plannedHtml).toContain('data-status="planned"');
    expect(plannedHtml).toMatch(/<span class="sr-only">Planned<\/span>/i);
  });

  it("paints race day in the race ink token, not a fuchsia literal", () => {
    const race = slot("2026-07-30", "race", null, {
      raceName: "Gran Fondo Alpe",
    });
    const html = renderToString(
      <WeekDayList days={[race]} today="2026-07-28" openDate="2026-07-30" />
    );
    expect(html).toContain("Gran Fondo Alpe");
    expect(html).toMatch(/text-ink-race/);
    expect(html).not.toMatch(/fuchsia/);
  });

  it("has no type below the 12px floor and no ad-hoc white alphas", () => {
    // Today (2026-07-28) has a workout in CURRENT_WEEK_DAYS and is the open
    // day, so <DayActions> mounts inline on its row (isOpen && actionable &&
    // workouts.length > 0). DayActions (src/components/week/day-actions.tsx)
    // is on the token scale as of slice-2 Task 5, so the unmodified fixture
    // is safe here — except CURRENT_WEEK_DAYS' own Tuesday is "completed"
    // (I4, final whole-branch review: DayActions no longer mounts on a
    // completed day at all), which would silently stop this test from
    // covering DayActions. Overridden to "planned" here, and only here, so
    // this test keeps exercising what its comment says it does.
    const days = CURRENT_WEEK_DAYS.map((d) =>
      d.date === "2026-07-28" ? { ...d, status: "planned" as const } : d
    );
    const html = renderToString(
      <WeekDayList days={days} today="2026-07-28" openDate="2026-07-28" />
    );
    expect(html).not.toMatch(/text-\[[\d.]+px\]/);
    expect(html).not.toMatch(/\btext-xs\b/);
    expect(html).not.toMatch(/text-white\//);
    expect(html).not.toMatch(/bg-white\//);
    expect(html).not.toMatch(/border-white\//);
  });

  it("keeps the open day's workout row on the ink scale, distinct from a next-week preview row", () => {
    // Guards the isOpen ternary directly: a literal swapped onto just the
    // open-day branch (e.g. "font-bold text-white") would pass every other
    // test in this file, since those only assert on the open row alone.
    // Comparing it against a next-week preview row (isOpen=false) in the
    // SAME render exercises both sides of the branch that survived the
    // Task 4 rewrite — the not-open path used to belong to "not today",
    // now it belongs to "not the open day", and only next-week rows still
    // take it.
    const html = renderToString(
      <WeekDayList
        days={CURRENT_WEEK_DAYS}
        today="2026-07-28"
        openDate="2026-07-28"
        nextWeek={{
          days: NEXT_WEEK_DAYS,
          pinned: {},
          targetHours: 13,
          availabilityHref: "/train?availability=next",
        }}
      />
    );

    const rowsByDate = html.split('data-date="').slice(1);
    const openRow = rowsByDate.find((r) => r.startsWith("2026-07-28"));
    const previewRow = rowsByDate.find((r) => r.startsWith("2026-08-03"));
    expect(openRow).toBeDefined();
    expect(previewRow).toBeDefined();

    // isOpen branch: bold, text-ink-primary.
    expect(openRow).toContain(
      'class="truncate text-caption font-bold text-ink-primary"'
    );
    // Not-open branch (a next-week preview row, also has a workout): not
    // bold, text-ink-secondary.
    expect(previewRow).toContain(
      'class="truncate text-caption text-ink-secondary"'
    );
  });
});

// I4, final whole-branch review: before Task 4, `visibleDays = days.filter(
// d => d.date >= today)` meant a past day had no row and no actions at all.
// The day strip now makes every day — including every past one — one tap
// from its own row, and DayActions used to mount there with no guard
// beyond "is this the open day and does it have a workout". moveWorkout /
// swapWorkouts (service.ts) refuse a completed/missed SOURCE day, so Move
// and Target-day on one are a guaranteed dead end; zeroDay
// ("No time today") has no such guard at all and would write a real
// zero-availability override for a day the athlete demonstrably trained.
//
// Chosen fix (argued in the report): hide DayActions rather than guard
// zeroDay alone. Guarding zeroDay only would still leave Move and Target
// day visually tappable-but-doomed — a confusing dead end the server
// safely rejects but the UI still offers. Hiding the whole row restores
// exactly the pre-Task-4 invariant ("past days had no actions") and closes
// all four actions (Move, Target day, What if?, No time today) in the one
// place that decides whether the row can succeed at all.
describe("WeekDayList — I4: DayActions only mounts where it can succeed", () => {
  const THREE_DAYS_AGO = localYmd(new Date(Date.now() - 3 * 86_400_000));

  it("hides DayActions on a completed open day, even though it's open", () => {
    const html = renderToString(
      <WeekDayList
        today={TODAY}
        openDate={TODAY}
        days={[slot(TODAY, "completed", tempo)]}
      />
    );
    expect(html).not.toContain('aria-label="Plan change"');
  });

  // The I3 gap this mirrors: adapt-day.ts's handleMissedYesterday only
  // ever looks at yesterday, so a day three days gone can still carry
  // `status: "planned"` — never "completed" — forever. A status check
  // alone would miss exactly this day; the date floor is what catches it.
  it("hides DayActions on a past open day never stamped completed or missed", () => {
    const html = renderToString(
      <WeekDayList
        today={TODAY}
        openDate={THREE_DAYS_AGO}
        days={[slot(THREE_DAYS_AGO, "planned", tempo)]}
      />
    );
    expect(html).not.toContain('aria-label="Plan change"');
  });

  it("still shows DayActions on today's open day when nothing has happened yet", () => {
    const html = renderToString(
      <WeekDayList
        today={TODAY}
        openDate={TODAY}
        days={[slot(TODAY, "planned", tempo)]}
      />
    );
    expect(html).toContain('aria-label="Plan change"');
  });

  it("still shows DayActions on a future open day", () => {
    const html = renderToString(
      <WeekDayList
        today={TODAY}
        openDate={TOMORROW}
        days={[slot(TODAY, "rest"), slot(TOMORROW, "planned", tempo)]}
      />
    );
    expect(html).toContain('aria-label="Plan change"');
  });
});

describe("WeekDayList — the structured workout", () => {
  const bikeDay: DaySlot["workouts"][number] = withPurpose({
    day: 0,
    sport: "Bike",
    type: "Tempo",
    durationMins: 75,
    intensity: "Z4",
    description: "Tempo ride — steady sweetspot effort",
    placement: blockPlacement(0),
  });

  const days: DaySlot[] = [
    slot(TODAY, "planned", bikeDay),
    slot(TOMORROW, "planned", bikeDay),
  ];

  it("shows the workout name, the derived line and the profile on the open day", () => {
    const structured = [workoutForDay(bikeDay, TODAY)];
    expect(
      structured[0],
      "the library must answer a 75-minute Bike Tempo"
    ).not.toBeNull();
    const html = renderToString(
      <WeekDayList
        days={days}
        today={TODAY}
        openDate={TODAY}
        structured={structured}
      />
    );
    expect(html).toContain("data-structured-workout");
    expect(html).toContain(structured[0]!.workout.name);
    expect(html).toContain("data-workout-profile");
  });

  /**
   * THE DEFECT THIS TEST EXISTS FOR, found by opening a CI capture rather
   * than by any assertion: the open day rendered "Long · 95 min Z1-Z2" with
   * "3 × 10 min at 76-85% FTP" directly beneath it. The planner's literal and
   * the library never knew about each other, so the card contradicted itself
   * in both themes and both viewports, and axe reported 0 confirmed because
   * a card disagreeing with itself is not an accessibility fault.
   *
   * Asserted at the SURFACE and through the real `workoutForDay`, not against
   * a hand-built band: a unit test of `reconcileBand` cannot prove the page
   * renders its result rather than `w.intensity`.
   */
  it("shows the band widened to cover the workout, not the planner's literal", () => {
    const longDay: DaySlot["workouts"][number] = withPurpose({
      day: 0,
      sport: "Bike",
      type: "Long",
      durationMins: 95,
      intensity: "Z1-Z2",
      description: "Long ride",
      placement: blockPlacement(0),
    });
    const structured = [workoutForDay(longDay, TODAY)];
    expect(
      structured[0],
      "the library must answer a 95-minute Bike Long"
    ).not.toBeNull();
    const html = renderToString(
      <WeekDayList
        days={[slot(TODAY, "planned", longDay)]}
        today={TODAY}
        openDate={TODAY}
        structured={structured}
      />
    );
    // Whichever long workout the date seed picks, the band shown must cover
    // it — pinning one workout id here would make this test a hostage to the
    // library's growth, which is the thing that grows most often.
    const peak = Math.max(
      ...structured[0]!.blocks.flatMap((b) => b.steps.map((st) => st.hi))
    );
    const expected =
      peak > 75 ? `Z1-Z${peak <= 90 ? 3 : peak <= 105 ? 4 : 5}` : "Z1-Z2";
    expect(html).toContain(expected);
    if (expected !== "Z1-Z2") {
      // The contradiction itself: the old literal must be GONE, not merely
      // accompanied by the corrected one.
      expect(html).not.toContain(">Z1-Z2<");
    }
  });

  it("shows nothing structured when the library refuses", () => {
    // A run is not cycling. The row must render exactly what it rendered
    // before this feature existed — prose and band, nothing else.
    const html = renderToString(
      <WeekDayList
        days={days}
        today={TODAY}
        openDate={TODAY}
        structured={[null]}
      />
    );
    expect(html).not.toContain("data-structured-workout");
    expect(html).toContain("Tempo");
  });

  it("shows nothing structured when the prop is absent entirely", () => {
    // Every existing caller passes nothing; none of them may change.
    const html = renderToString(
      <WeekDayList days={days} today={TODAY} openDate={TODAY} />
    );
    expect(html).not.toContain("data-structured-workout");
  });

  it("never draws a profile on a collapsed row", () => {
    // structured is only ever passed for the open day; a profile on seven
    // rows would bury the one the athlete opened.
    const html = renderToString(
      <WeekDayList
        days={days}
        today={TODAY}
        openDate={TOMORROW}
        structured={[workoutForDay(bikeDay, TOMORROW)]}
      />
    );
    expect((html.match(/data-workout-profile/g) ?? []).length).toBe(1);
  });
});

describe("WeekDayList — the .zwo download", () => {
  const bikeDay: DaySlot["workouts"][number] = withPurpose({
    day: 0,
    sport: "Bike",
    type: "Tempo",
    durationMins: 75,
    intensity: "Z4",
    description: "Tempo ride",
    placement: blockPlacement(0),
  });
  const days: DaySlot[] = [slot(TODAY, "planned", bikeDay)];

  it("links to the route with this day's own date and session index", () => {
    const html = renderToString(
      <WeekDayList
        days={days}
        today={TODAY}
        openDate={TODAY}
        structured={[workoutForDay(bikeDay, TODAY)]}
      />
    );
    expect(html).toContain(`/api/workout/zwo?date=${TODAY}&amp;i=0`);
  });

  it("offers no download when the library refused", () => {
    const html = renderToString(
      <WeekDayList
        days={days}
        today={TODAY}
        openDate={TODAY}
        structured={[null]}
      />
    );
    expect(html).not.toContain("/api/workout/zwo");
  });
});

describe("WeekDayList — the export pin", () => {
  const base = {
    day: 0,
    sport: "Bike",
    type: "Tempo",
    durationMins: 75,
    intensity: "Z4",
    description: "Tempo ride",
    placement: blockPlacement(0),
  };
  const pin = {
    workoutId: "ou-3x12",
    exportedAt: "2026-09-01T07:00:00.000Z",
    purpose: "threshold" as const,
    durationMins: 75,
  };

  const render1 = (w: DaySlot["workouts"][number]) =>
    renderToString(
      <WeekDayList
        days={[slot(TODAY, "planned", w)]}
        today={TODAY}
        openDate={TODAY}
        structured={[workoutForDay(w, TODAY)]}
      />
    );

  it("shows the pinned workout, not a freshly chosen one", () => {
    const w = withPurpose({ ...base, pin });
    expect(render1(w)).toContain("Over-Under 3×12");
  });

  it("says nothing about staleness while the session still matches", () => {
    expect(render1(withPurpose({ ...base, pin }))).not.toContain(
      "data-workout-stale"
    );
  });

  it("marks it stale once the day's length moved under it", () => {
    // Red readiness scaled the day; the head unit still holds the 75.
    const w = withPurpose({ ...base, durationMins: 53, pin });
    const html = render1(w);
    expect(html).toContain("data-workout-stale");
    // And it still shows what was SENT, rather than swapping it silently.
    expect(html).toContain("Over-Under 3×12");
  });

  it("marks it stale once the day's purpose changed under it", () => {
    // Amber steps Tempo down to Endurance, which re-derives the purpose.
    const w = withPurpose({ ...base, type: "Endurance", pin });
    expect(render1(w)).toContain("data-workout-stale");
  });
});
