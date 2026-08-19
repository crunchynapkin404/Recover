import { describe, expect, it } from "vitest";
import {
  WEEKDAY_NAMES,
  WEEKDAY_SHORT,
  WEEKDAY_NARROW,
  WEEKDAY_INITIAL,
  weekdayIndex,
} from "./weekdays";

describe("weekday vocabulary", () => {
  it("is seven long at every length", () => {
    for (const set of [
      WEEKDAY_NAMES,
      WEEKDAY_SHORT,
      WEEKDAY_NARROW,
      WEEKDAY_INITIAL,
    ])
      expect(set).toHaveLength(7);
  });

  // The invariant that matters: the lengths must agree about which day each
  // index is, or a strip and the list beneath it label the same day twice.
  it("agrees on the day at every index, across all four lengths", () => {
    for (let i = 0; i < 7; i++) {
      expect(WEEKDAY_NAMES[i].startsWith(WEEKDAY_SHORT[i])).toBe(true);
      expect(WEEKDAY_SHORT[i].startsWith(WEEKDAY_NARROW[i])).toBe(true);
      expect(WEEKDAY_NARROW[i].startsWith(WEEKDAY_INITIAL[i])).toBe(true);
    }
  });

  it("is Monday-first, which is the app's week everywhere", () => {
    expect(WEEKDAY_NAMES[0]).toBe("Monday");
    expect(WEEKDAY_NAMES[6]).toBe("Sunday");
  });
});

describe("weekdayIndex", () => {
  it("indexes Monday as 0 and Sunday as 6", () => {
    // 2026-08-17 is a Monday.
    expect(weekdayIndex("2026-08-17")).toBe(0);
    expect(weekdayIndex("2026-08-23")).toBe(6);
  });

  it("names the day the athlete would name", () => {
    expect(WEEKDAY_NAMES[weekdayIndex("2026-08-18")]).toBe("Tuesday");
    expect(WEEKDAY_SHORT[weekdayIndex("2026-08-22")]).toBe("Sat");
  });

  it("does not shift for a server west of UTC", () => {
    // The bug this guards: a local-time Date built from "…T00:00:00" lands on
    // the previous day for anyone behind UTC, moving every label by one.
    const tz = process.env.TZ;
    process.env.TZ = "America/Los_Angeles";
    try {
      expect(weekdayIndex("2026-08-17")).toBe(0);
    } finally {
      process.env.TZ = tz;
    }
  });
});
