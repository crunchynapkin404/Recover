import { describe, expect, it } from "vitest";
import { computeStreaks } from "./milestones";

const TODAY = "2026-08-20";

describe("computeStreaks", () => {
  it("empty history", () => {
    expect(computeStreaks([], TODAY)).toEqual({ current: 0, best: 0 });
  });

  it("run ending today", () => {
    expect(
      computeStreaks(["2026-08-18", "2026-08-19", "2026-08-20"], TODAY)
    ).toEqual({ current: 3, best: 3 });
  });

  it("today not yet logged doesn't break yesterday's run", () => {
    expect(computeStreaks(["2026-08-18", "2026-08-19"], TODAY)).toEqual({
      current: 2,
      best: 2,
    });
  });

  it("a run ending before yesterday is not current; best survives", () => {
    expect(
      computeStreaks(
        ["2026-08-10", "2026-08-11", "2026-08-12", "2026-08-13"],
        TODAY
      )
    ).toEqual({ current: 0, best: 4 });
  });

  it("gaps split runs; best is the longest ever", () => {
    expect(
      computeStreaks(
        ["2026-08-01", "2026-08-02", "2026-08-03", "2026-08-19"],
        TODAY
      )
    ).toEqual({ current: 1, best: 3 });
  });

  it("duplicates and unsorted input are tolerated", () => {
    expect(
      computeStreaks(["2026-08-20", "2026-08-19", "2026-08-19"], TODAY)
    ).toEqual({ current: 2, best: 2 });
  });
});
