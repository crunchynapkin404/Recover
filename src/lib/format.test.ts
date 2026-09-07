import { describe, expect, it } from "vitest";
import { formatDay, formatDayRange } from "./format";

describe("formatDayRange", () => {
  it("says the month once when the span does not leave it", () => {
    expect(formatDayRange("2026-09-07", "2026-09-13")).toBe("Sep 7–13");
  });

  it("says both months when the span crosses one", () => {
    expect(formatDayRange("2026-09-28", "2026-10-04")).toBe("Sep 28 – Oct 4");
  });

  it("says both when the span crosses a year, rather than reading as one month", () => {
    expect(formatDayRange("2026-12-28", "2027-01-03")).toBe("Dec 28 – Jan 3");
  });

  it("agrees with formatDay on its own endpoints", () => {
    // The reason this is built on formatDay rather than beside it: a week's
    // dates and a single day's must not drift into two spellings.
    const start = "2026-09-28";
    expect(
      formatDayRange(start, "2026-10-04").startsWith(formatDay(start))
    ).toBe(true);
  });

  it("takes Dates as well as YYYY-MM-DD, reading a string as local midnight", () => {
    // A bare `new Date("2026-09-07")` is UTC midnight, which is the previous
    // day west of Greenwich — the string form must not inherit that.
    expect(formatDayRange("2026-09-07", "2026-09-13")).toBe(
      formatDayRange(new Date(2026, 8, 7), new Date(2026, 8, 13))
    );
  });
});
