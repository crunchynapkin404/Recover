import { describe, expect, it } from "vitest";
import { ctlBaselineYmd } from "./weekly-review-window";

describe("ctlBaselineYmd", () => {
  it("baselines on the day before the week under review", () => {
    // The review's load, sessions and readiness all cover Mon-Sun. The CTL
    // delta must span the same days, so its baseline is the Sunday before.
    expect(ctlBaselineYmd("2026-08-03")).toBe("2026-08-02");
  });

  it("crosses a month boundary correctly", () => {
    expect(ctlBaselineYmd("2026-09-01")).toBe("2026-08-31");
  });

  it("crosses a year boundary correctly", () => {
    expect(ctlBaselineYmd("2026-01-04")).toBe("2026-01-03");
  });

  it("is not a rolling seven-day lookback", () => {
    // The defect: ctlDelta used `now - 7 days` while every other figure in
    // the same sentence used the calendar week. On any day but the week's
    // first, those are different days — and the sentence at
    // weekly-review.ts:262 renders both as "this week".
    const weekStart = "2026-08-03";
    const sevenAgoFromMidWeek = "2026-07-30"; // if `now` were Thu 6 Aug
    expect(ctlBaselineYmd(weekStart)).not.toBe(sevenAgoFromMidWeek);
  });
});
