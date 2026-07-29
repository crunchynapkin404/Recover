import { describe, expect, it } from "vitest";
import { isMondayYmd } from "./validate-week-start";

describe("isMondayYmd", () => {
  it("accepts a genuine Monday", () => {
    expect(isMondayYmd("2027-03-01")).toBe(true);
  });

  it("rejects a non-Monday date", () => {
    expect(isMondayYmd("2027-03-02")).toBe(false); // Tuesday
    expect(isMondayYmd("2027-03-03")).toBe(false); // Wednesday
    expect(isMondayYmd("2027-03-07")).toBe(false); // Sunday
  });

  it("rejects a malformed shape", () => {
    expect(isMondayYmd("2027-3-1")).toBe(false);
    expect(isMondayYmd("03-01-2027")).toBe(false);
    expect(isMondayYmd("not-a-date")).toBe(false);
    expect(isMondayYmd("")).toBe(false);
  });

  // 2027 is not a leap year, so February has 28 days. JS's Date rolls
  // "2027-02-30" into March rather than throwing — the round-trip check
  // must catch that instead of trusting whatever getDay() reports for the
  // rolled-over date.
  it("rejects a calendar date that does not exist", () => {
    expect(isMondayYmd("2027-02-30")).toBe(false);
  });

  it("rejects an out-of-range month or day even with the right digit shape", () => {
    expect(isMondayYmd("2027-13-01")).toBe(false);
    expect(isMondayYmd("2027-00-01")).toBe(false);
  });
});
