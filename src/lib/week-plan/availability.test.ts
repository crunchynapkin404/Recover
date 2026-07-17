// src/lib/week-plan/availability.test.ts
import { describe, expect, it } from "vitest";
import { prefillAvailability } from "./availability";

describe("prefillAvailability", () => {
  it("repeats last week's pattern when there is one", () => {
    const last = [0, 60, 0, 60, 45, 120, 150];
    expect(
      prefillAvailability({
        hoursPerWeek: 8,
        daysPerWeek: 5,
        lastWeekMins: last,
        busyMinsPerDay: null,
      })
    ).toEqual(last);
  });

  it("first week: spreads hoursPerWeek over the last daysPerWeek days", () => {
    const r = prefillAvailability({
      hoursPerWeek: 6,
      daysPerWeek: 4,
      lastWeekMins: null,
      busyMinsPerDay: null,
    });
    expect(r.slice(0, 3)).toEqual([0, 0, 0]); // Mon–Wed free of training
    expect(r.slice(3).reduce((s, m) => s + m, 0)).toBe(360);
    expect(r.every((m) => m % 5 === 0)).toBe(true);
  });

  it("halves the suggestion on calendar-busy days (≥480 busy mins)", () => {
    const r = prefillAvailability({
      hoursPerWeek: 8,
      daysPerWeek: 5,
      lastWeekMins: [60, 60, 60, 60, 60, 120, 120],
      busyMinsPerDay: [500, 0, 0, 0, 0, 0, 0],
    });
    expect(r[0]).toBe(30);
    expect(r[1]).toBe(60);
  });

  it("no calendar connection changes nothing", () => {
    const last = [60, 60, 60, 60, 60, 120, 120];
    expect(
      prefillAvailability({
        hoursPerWeek: 8,
        daysPerWeek: 5,
        lastWeekMins: last,
        busyMinsPerDay: null,
      })
    ).toEqual(last);
  });
});
