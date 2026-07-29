import { describe, expect, it } from "vitest";
import { isMondayYmd, resolveWeekStartTarget } from "./validate-week-start";

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

// Final-review Finding 1: `submitAvailability` must not treat a `weekStart`
// as "future" just because it's present — it must compare against the week
// that is ACTUALLY open. This is the pure decision behind that fix, tested
// here (CI-visible, no DATABASE_URL needed) rather than only in
// tests/submit-availability-week.test.ts, which is DB-gated and does not run
// in CI.
describe("resolveWeekStartTarget", () => {
  it("is the current week when nothing was requested", () => {
    expect(resolveWeekStartTarget(null, "2027-03-01")).toEqual({
      kind: "current",
    });
    // Even with no open week at all to compare against.
    expect(resolveWeekStartTarget(null, null)).toEqual({ kind: "current" });
  });

  it("is the current week when the requested Monday equals the open week's own — the Sunday→Monday race", () => {
    expect(resolveWeekStartTarget("2027-03-01", "2027-03-01")).toEqual({
      kind: "current",
    });
  });

  it("is a genuine future week when the requested Monday is strictly after the open week's", () => {
    expect(resolveWeekStartTarget("2027-03-08", "2027-03-01")).toEqual({
      kind: "future",
      weekStart: "2027-03-08",
    });
  });

  it("is rejected as past when the requested Monday is strictly before the open week's", () => {
    expect(resolveWeekStartTarget("2027-02-22", "2027-03-01")).toEqual({
      kind: "rejected",
      reason: "past",
    });
  });

  it("treats any requested Monday as future when there is no open week to compare against", () => {
    expect(resolveWeekStartTarget("2027-03-01", null)).toEqual({
      kind: "future",
      weekStart: "2027-03-01",
    });
    // Even a Monday that would, calendar-wise, be "in the past" relative to
    // today: with no open week there is nothing to judge it against, so
    // this is unchanged from before Finding 1.
    expect(resolveWeekStartTarget("2020-01-06", null)).toEqual({
      kind: "future",
      weekStart: "2020-01-06",
    });
  });
});
