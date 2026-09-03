import { describe, expect, it } from "vitest";
import { describeReadingAge } from "./reading-age";

describe("describeReadingAge", () => {
  // The normal case, and the one the whole card is shaped around: a reading
  // taken this morning needs no marker, so the card renders exactly as it
  // does at every other hour of the day.
  it("returns null for a reading from today", () => {
    expect(describeReadingAge("2026-09-03", "2026-09-03")).toBeNull();
  });

  it("names yesterday as yesterday", () => {
    expect(describeReadingAge("2026-09-02", "2026-09-03")).toBe("yesterday");
  });

  // Inside the last week a weekday is more use than a count — "Monday" is
  // something an athlete can place; "3 days ago" needs arithmetic.
  it("names a weekday within the last week", () => {
    // 2026-08-31 is a Monday; 2026-09-03 is the Thursday after it.
    expect(describeReadingAge("2026-08-31", "2026-09-03")).toBe("Monday");
  });

  it("counts days once a weekday name would be ambiguous", () => {
    // 7 days back is the same weekday, so the name stops disambiguating.
    expect(describeReadingAge("2026-08-27", "2026-09-03")).toBe("7 days ago");
    expect(describeReadingAge("2026-08-04", "2026-09-03")).toBe("30 days ago");
  });

  // The 30-day metrics window means this is reachable in production, and it
  // is the case that had NO marker in any state before: page.tsx walks back
  // through 30 days of metrics for the first non-null readiness.
  it("marks a reading at the far edge of the metrics window", () => {
    expect(describeReadingAge("2026-08-05", "2026-09-04")).toBe("30 days ago");
  });

  // A future-dated reading is clock skew or a mis-stored date. It is not
  // stale, and inventing "in 2 days" would be worse than saying nothing.
  it("treats a future-dated reading as fresh rather than inventing a phrase", () => {
    expect(describeReadingAge("2026-09-05", "2026-09-03")).toBeNull();
  });

  it("returns null when there is no reading date at all", () => {
    expect(describeReadingAge(null, "2026-09-03")).toBeNull();
    expect(describeReadingAge(undefined, "2026-09-03")).toBeNull();
  });
});

describe("describeReadingAge with a Date input", () => {
  // Drizzle types daily_metrics.date as Date but returns a "2026-05-17"
  // STRING at runtime (verified against the dev database). Callers pass a
  // value TypeScript believes is a Date, so both must work.
  it("accepts a Date without shifting the day", () => {
    expect(
      describeReadingAge(new Date("2026-09-02T00:00:00Z"), "2026-09-03")
    ).toBe("yesterday");
  });

  it("returns null for a Date that is today", () => {
    expect(
      describeReadingAge(new Date("2026-09-03T00:00:00Z"), "2026-09-03")
    ).toBeNull();
  });
});
