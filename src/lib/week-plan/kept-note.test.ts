import { describe, it, expect } from "vitest";
import { keptNote } from "./kept-note";
import { athletePlacement, blockPlacement } from "./placement";
import type { DaySlot, ScheduledWorkout } from "./types";

const chosen: ScheduledWorkout = {
  day: 1,
  sport: "Bike",
  type: "Intervals",
  durationMins: 75,
  intensity: "Z4-Z5",
  description: "",
  purpose: "vo2max",
  minEffectiveMins: 40,
  placement: athletePlacement({
    workoutId: "vo2-5x5",
    chosenAt: "2026-09-03T07:00:00.000Z",
  }),
};

const day: DaySlot = {
  date: "2026-09-08",
  availableBlocks: [],
  workouts: [chosen],
  availableMins: 0,
  status: "planned",
};

describe("keptNote", () => {
  it("records disagreement on a red band", () => {
    const note = keptNote(day, chosen, "red")!;
    expect(note.trigger).toBe("athlete_choice");
    expect(note.action).toBe("kept");
    expect(note.reasonCode).toBe("chosen_kept_on_red");
    expect(note.reason).toContain("your choice");
  });

  it("records disagreement on a pre-race rest day", () => {
    const note = keptNote({ ...day, restIntent: "pre_race" }, chosen, "green")!;
    expect(note.reasonCode).toBe("chosen_on_pre_race_rest");
  });

  it("reports pre-race rest ahead of the band when both apply", () => {
    // A taper is the more consequential of the two and names the reason the
    // day was empty in the first place.
    const note = keptNote({ ...day, restIntent: "pre_race" }, chosen, "red")!;
    expect(note.reasonCode).toBe("chosen_on_pre_race_rest");
  });

  it("says nothing when the engine does not disagree", () => {
    // Silence is the common case. A note on every chosen session is noise,
    // and noise is how a real warning gets ignored.
    expect(keptNote(day, chosen, "green")).toBeNull();
    expect(keptNote(day, chosen, "amber")).toBeNull();
  });

  it("says nothing about a non-quality pick on a red band", () => {
    // Choosing a recovery spin on a red day is agreement, not defiance.
    const easy: ScheduledWorkout = {
      ...chosen,
      type: "Recovery",
      purpose: "recovery",
      intensity: "Recovery",
    };
    expect(keptNote(day, easy, "red")).toBeNull();
  });

  it("says nothing about an engine-placed session", () => {
    // Those the engine may simply change; there is nothing to record.
    expect(
      keptNote(day, { ...chosen, placement: blockPlacement(0) }, "red")
    ).toBeNull();
  });

  it("leaves the day unchanged in before and after", () => {
    // "kept" means exactly that: the record exists to explain a non-change.
    const note = keptNote(day, chosen, "red")!;
    expect(note.before).toEqual(note.after);
  });
});
