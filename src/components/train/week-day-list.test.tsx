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

describe("WeekDayList", () => {
  it("renders one row per day with workout, intensity and status", () => {
    const html = renderToString(
      <WeekDayList
        days={[
          slot(YESTERDAY, "completed", tempo),
          slot(TODAY, "planned", tempo),
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
        days={[slot(YESTERDAY, "completed", tempo), slot(TODAY, "rest")]}
      />
    );
    expect(html.match(/data-today/g) ?? []).toHaveLength(1);
  });

  it("shows free minutes on a rest day instead of inventing a session", () => {
    const html = renderToString(
      <WeekDayList days={[slot(TOMORROW, "rest")]} />
    );
    expect(html).toContain("Rest");
    expect(html).toContain("90 min free");
  });

  it("names the race rather than the workout on a race day", () => {
    const html = renderToString(
      <WeekDayList
        days={[slot(TOMORROW, "race", null, { raceName: "Gran Fondo" })]}
      />
    );
    expect(html).toContain("Gran Fondo");
  });

  it("credits a moved session with the weekday it came from", () => {
    const html = renderToString(
      <WeekDayList
        days={[slot(TODAY, "moved", tempo, { movedFrom: YESTERDAY })]}
      />
    );
    const from = new Date(YESTERDAY + "T00:00:00").toLocaleDateString("en-US", {
      weekday: "short",
    });
    expect(html).toContain(`moved from ${from}`);
  });
});
