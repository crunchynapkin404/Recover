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
  it("renders one row per day with workout, intensity and status", () => {
    const html = renderToString(
      <WeekDayList
        today={TODAY}
        days={[
          slot(TODAY, "completed", tempo),
          slot(TOMORROW, "planned", tempo),
        ]}
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
    expect(html).toContain('data-status="planned"');
    expect(html).toContain('<span class="sr-only">Planned</span>');
  });

  it("marks only today's row", () => {
    const html = renderToString(
      <WeekDayList
        today={TODAY}
        days={[slot(TODAY, "rest"), slot(TOMORROW, "completed", tempo)]}
      />
    );
    expect(html.match(/data-today/g) ?? []).toHaveLength(1);
  });

  it("shows free minutes on a rest day instead of inventing a session", () => {
    const html = renderToString(
      <WeekDayList today={TODAY} days={[slot(TOMORROW, "rest")]} />
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
      <WeekDayList today={TODAY} days={[slot(TODAY, "rest")]} actuals={{}} />
    );
    expect(html).toContain("Rest");
    expect(html).not.toContain("session");
  });

  it("names the race rather than the workout on a race day", () => {
    const html = renderToString(
      <WeekDayList
        today={TODAY}
        days={[slot(TOMORROW, "race", null, { raceName: "Gran Fondo" })]}
      />
    );
    expect(html).toContain("Gran Fondo");
  });

  it("credits a moved session with the weekday it came from", () => {
    const html = renderToString(
      <WeekDayList
        today={TODAY}
        days={[slot(TODAY, "moved", tempo, { movedFrom: YESTERDAY })]}
      />
    );
    const from = new Date(YESTERDAY + "T00:00:00").toLocaleDateString("en-US", {
      weekday: "short",
    });
    expect(html).toContain(`moved from ${from}`);
  });

  it("excludes a dropped past day from today's move/swap targets", () => {
    // A rest day before today is dropped from the visible list — it must
    // not leak back in as a selectable DayActions "Target day" option for
    // today's row, which would let the athlete move a session onto a day
    // whose own row they can no longer even see.
    const html = renderToString(
      <WeekDayList
        today="2026-07-28"
        days={[
          // Mon, dropped, no workout — would otherwise pass DayActions'
          // own "move" target filter and show up in the dropdown.
          slot("2026-07-27", "rest"),
          slot("2026-07-28", "planned", tempo), // Tue — today
        ]}
      />
    );
    expect(html).not.toContain("2026-07-27");
  });

  it("drops days before today but never today itself", () => {
    const html = renderToString(
      <WeekDayList
        days={CURRENT_WEEK_DAYS} // Mon..Sun, Mon+Tue completed, today = Tue
        today="2026-07-28"
        nextWeek={null}
      />
    );
    expect(html).not.toContain("2026-07-27");
    expect(html).toContain("2026-07-28");
  });

  it("shows next week under a boundary, marked provisional", () => {
    const html = renderToString(
      <WeekDayList
        days={CURRENT_WEEK_DAYS}
        today="2026-07-28"
        nextWeek={{ days: NEXT_WEEK_DAYS, pinned: {} }}
      />
    );
    expect(html).toContain("next week");
    expect(html).toContain("provisional");
  });

  it("does not mark a pinned day provisional", () => {
    const html = renderToString(
      <WeekDayList
        days={CURRENT_WEEK_DAYS}
        today="2026-07-28"
        nextWeek={{ days: NEXT_WEEK_DAYS, pinned: { "2026-08-04": true } }}
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
        nextWeek={{ days: allRest, pinned: {} }}
      />
    );
    expect(html).toContain("No availability set for next week");
  });
});

describe("WeekDayList — status as a dot, not a pill (v0.99 slice 2)", () => {
  it("names the status for assistive tech without printing it as a pill", () => {
    const html = renderToString(
      <WeekDayList days={CURRENT_WEEK_DAYS} today="2026-07-28" />
    );
    // The dot carries the status in the DOM the way week-strip does.
    expect(html).toContain('data-status="completed"');
    expect(html).toContain('data-status="planned"');
    // …and names it for a screen reader.
    expect(html).toMatch(/<span class="sr-only">Completed<\/span>/i);
    // But the uppercase text pill is gone: no visible bare status word.
    expect(html).not.toMatch(/uppercase[^"]*">\s*completed/i);
  });

  it("paints race day in the race ink token, not a fuchsia literal", () => {
    const race = slot("2026-07-30", "race", null, {
      raceName: "Gran Fondo Alpe",
    });
    const html = renderToString(
      <WeekDayList days={[race]} today="2026-07-28" />
    );
    expect(html).toContain("Gran Fondo Alpe");
    expect(html).toMatch(/text-ink-race/);
    expect(html).not.toMatch(/fuchsia/);
  });

  it("has no type below the 12px floor and no ad-hoc white alphas", () => {
    // Today (2026-07-28) has a workout in CURRENT_WEEK_DAYS, which mounts
    // <DayActions> inline on its row (isToday && workouts.length > 0).
    // DayActions (src/components/week/day-actions.tsx) is untouched here —
    // the slice-2 plan assigns it to Task 5 — and still carries its own
    // arbitrary sizes and ad-hoc alpha ink. Stripping today's workout keeps
    // this assertion scoped to what WeekDayList itself renders, which is
    // this test's actual subject; every other row still exercises the
    // workout, rest and status-dot classes this task migrated.
    const days = CURRENT_WEEK_DAYS.map((d) =>
      d.date === "2026-07-28" ? { ...d, workouts: [] } : d
    );
    const html = renderToString(<WeekDayList days={days} today="2026-07-28" />);
    expect(html).not.toMatch(/text-\[[\d.]+px\]/);
    expect(html).not.toMatch(/\btext-xs\b/);
    expect(html).not.toMatch(/text-white\//);
    expect(html).not.toMatch(/bg-white\//);
    expect(html).not.toMatch(/border-white\//);
  });
});
