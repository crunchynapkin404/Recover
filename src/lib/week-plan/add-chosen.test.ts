import { describe, it, expect } from "vitest";
import {
  buildChosenSession,
  canAddWorkout,
  durationRangeFor,
} from "./add-chosen";
import type { DaySlot } from "./types";
import { LIBRARY } from "@/lib/interval/library";

const empty: DaySlot = {
  date: "2026-09-10",
  availableBlocks: [],
  workouts: [],
  availableMins: 0,
  status: "rest",
};

const NOW = "2026-09-03T07:00:00.000Z";
/** A real library workout, so the test cannot drift from the library. */
const VO2 = LIBRARY.find((w) => w.purpose === "vo2max")!;

describe("canAddWorkout", () => {
  it("allows an empty future day", () => {
    expect(canAddWorkout(empty, "2026-09-08")).toEqual({ ok: true });
  });

  it("allows today", () => {
    expect(canAddWorkout(empty, "2026-09-10")).toEqual({ ok: true });
  });

  it("refuses a past day", () => {
    expect(canAddWorkout(empty, "2026-09-11")).toEqual({
      ok: false,
      reason: "past_day",
    });
  });

  it.each(["completed", "missed", "race"] as const)(
    "refuses a %s day — historical fact",
    (status) => {
      expect(canAddWorkout({ ...empty, status }, "2026-09-08")).toEqual({
        ok: false,
        reason: "day_settled",
      });
    }
  );

  it("refuses a day already at the session cap", () => {
    const two = { ...empty, workouts: [{}, {}] } as unknown as DaySlot;
    expect(canAddWorkout(two, "2026-09-08")).toEqual({
      ok: false,
      reason: "day_full",
    });
  });

  it("allows a day that already holds one session", () => {
    const one = { ...empty, workouts: [{}] } as unknown as DaySlot;
    expect(canAddWorkout(one, "2026-09-08")).toEqual({ ok: true });
  });

  it("allows a pre-race rest day — the athlete asked for the agency", () => {
    // Not a refusal. Recover warns loudly (keptNote) and complies.
    expect(
      canAddWorkout({ ...empty, restIntent: "pre_race" }, "2026-09-08")
    ).toEqual({ ok: true });
  });
});

describe("durationRangeFor", () => {
  it("reports a range the workout can actually reach", () => {
    const range = durationRangeFor(VO2.id)!;
    expect(range.min).toBeLessThan(range.max);
    expect(buildChosenSession(VO2.id, range.min, 1, NOW)).not.toBeNull();
    expect(buildChosenSession(VO2.id, range.max, 1, NOW)).not.toBeNull();
  });

  it("reports nothing for a workout the library does not have", () => {
    expect(durationRangeFor("no-such-workout")).toBeNull();
  });

  it("excludes lengths just outside the range", () => {
    const range = durationRangeFor(VO2.id)!;
    expect(buildChosenSession(VO2.id, range.min - 1, 1, NOW)).toBeNull();
    expect(buildChosenSession(VO2.id, range.max + 1, 1, NOW)).toBeNull();
  });
});

describe("buildChosenSession", () => {
  it("derives type and purpose from the library workout", () => {
    const mid = durationRangeFor(VO2.id)!.min;
    const s = buildChosenSession(VO2.id, mid, 1, NOW)!;
    expect(s.purpose).toBe("vo2max");
    expect(s.type).toBe("Intervals");
    expect(s.sport).toBe("Bike");
    expect(s.day).toBe(1);
    expect(s.placement).toEqual({
      kind: "athlete",
      choice: { workoutId: VO2.id, chosenAt: NOW },
    });
  });

  it("returns null for a workout id the library does not have", () => {
    expect(buildChosenSession("no-such-workout", 60, 1, NOW)).toBeNull();
  });

  it("stores no description — it is derived on read", () => {
    // renderDescription owns the sentence; storing one in parallel is the
    // drift defect this repo has recorded three times.
    const mid = durationRangeFor(VO2.id)!.min;
    expect(buildChosenSession(VO2.id, mid, 1, NOW)!.description).toBe("");
  });

  it("covers every library purpose with a plan type", () => {
    // A purpose with no inverse in PURPOSE_BY_TYPE would be unpickable.
    for (const w of LIBRARY) {
      const range = durationRangeFor(w.id)!;
      expect(buildChosenSession(w.id, range.min, 0, NOW)).not.toBeNull();
    }
  });
});
