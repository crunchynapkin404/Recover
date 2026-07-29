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
    expect(html).toContain("completed");
    expect(html).toContain("planned");
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
