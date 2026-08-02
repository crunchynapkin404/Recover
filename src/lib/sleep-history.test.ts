import { describe, expect, it } from "vitest";
import { SLEEP_HISTORY_NIGHTS, selectNight } from "./sleep-history";

type N = { date: string; sleepSecs: number | null };

function night(date: string, sleepSecs: number | null = 20000): N {
  return { date, sleepSecs };
}

describe("selectNight", () => {
  const nights: N[] = [
    night("2026-07-27"),
    night("2026-07-28"),
    night("2026-07-29"),
    night("2026-07-30"),
    night("2026-07-31"),
    night("2026-08-01"),
  ];

  it("defaults to the newest night", () => {
    const { selected, index, recent } = selectNight(nights, undefined);
    expect(selected?.date).toBe("2026-08-01");
    expect(index).toBe(recent.length - 1);
  });

  it("honours a valid requested night", () => {
    expect(selectNight(nights, "2026-07-29").selected?.date).toBe("2026-07-29");
  });

  // A bad param must never reach a query — a malformed id hitting Postgres as
  // a raw literal 500'd /activity/[id] in v0.23.
  it("falls back to the newest night for unknown or malformed input", () => {
    for (const bad of [
      "2026-01-01", // well-formed but not loaded
      "not-a-date",
      "2026-8-1",
      "'; drop table wellness_daily;--",
      "",
    ]) {
      expect(selectNight(nights, bad).selected?.date, bad).toBe("2026-08-01");
    }
  });

  it("ignores nights without a sleep duration", () => {
    const withGap = [...nights, night("2026-08-02", null)];
    const { selected, recent } = selectNight(withGap, undefined);
    expect(selected?.date).toBe("2026-08-01");
    expect(recent.map((n) => n.date)).not.toContain("2026-08-02");
  });

  it("cannot select a night that has no duration", () => {
    const withGap = [...nights, night("2026-08-02", null)];
    expect(selectNight(withGap, "2026-08-02").selected?.date).toBe(
      "2026-08-01"
    );
  });

  it("caps the strip at SLEEP_HISTORY_NIGHTS, keeping the most recent", () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      night(`2026-06-${String(i + 1).padStart(2, "0")}`)
    );
    const { recent } = selectNight(many, undefined);
    expect(recent).toHaveLength(SLEEP_HISTORY_NIGHTS);
    expect(recent[recent.length - 1].date).toBe("2026-06-30");
    expect(recent[0].date).toBe(
      `2026-06-${String(30 - SLEEP_HISTORY_NIGHTS + 1).padStart(2, "0")}`
    );
  });

  it("returns recent oldest -> newest so the strip reads left to right", () => {
    const { recent } = selectNight(nights, undefined);
    expect(recent.map((n) => n.date)).toEqual([
      "2026-07-27",
      "2026-07-28",
      "2026-07-29",
      "2026-07-30",
      "2026-07-31",
      "2026-08-01",
    ]);
  });

  // The arrows step through `recent` by index; if index ever disagreed with
  // the strip the two controls would navigate to different nights.
  it("keeps index consistent with recent for every selectable night", () => {
    for (const n of nights) {
      const { selected, recent, index } = selectNight(nights, n.date);
      expect(recent[index].date).toBe(selected?.date);
    }
  });

  it("handles an empty history", () => {
    const { selected, recent, index } = selectNight([], undefined);
    expect(selected).toBeNull();
    expect(recent).toEqual([]);
    expect(index).toBe(-1);
  });

  it("handles a history where nothing has a duration", () => {
    const { selected, index } = selectNight(
      [night("2026-08-01", null), night("2026-08-02", null)],
      undefined
    );
    expect(selected).toBeNull();
    expect(index).toBe(-1);
  });
});
