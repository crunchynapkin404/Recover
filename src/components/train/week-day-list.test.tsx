import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { WeekDayList } from "./week-day-list";
import type { DaySlot } from "@/lib/week-plan/types";
import { withPurpose } from "@/lib/training-plan";

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
  blockIdx: 0,
});

const strengthSession: DaySlot["workouts"][number] = withPurpose({
  day: 0,
  sport: "Strength",
  type: "Strength",
  durationMins: 45,
  intensity: "4x8",
  description: "Squat 4x8 @ 130kg · Bench 4x8 @ 65kg",
  blockIdx: 0,
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
      blockIdx: 0,
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
    // day, so <DayActions> mounts inline on its row (isOpen &&
    // workouts.length > 0). DayActions (src/components/week/day-actions.tsx)
    // is on the token scale as of slice-2 Task 5, so the unmodified fixture
    // is safe here.
    const html = renderToString(
      <WeekDayList
        days={CURRENT_WEEK_DAYS}
        today="2026-07-28"
        openDate="2026-07-28"
      />
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
