import { describe, expect, it, vi, afterEach } from "vitest";
import {
  EVENING_HOUR,
  POST_SESSION_WINDOW_MS,
  hasDayLog,
  previewStateFrom,
  resolveTodayState,
} from "./state";

/** Local wall clock, which is what the selector reads. */
function at(iso: string): Date {
  return new Date(iso);
}

const noLog = { hasDayLog: false };

describe("resolveTodayState", () => {
  it("leads with readiness in the morning", () => {
    expect(
      resolveTodayState({
        now: at("2026-08-11T09:14:00"),
        lastSessionEndedAt: null,
        ...noLog,
      })
    ).toBe("morning");
  });

  it("leads with the activity just after a session lands", () => {
    expect(
      resolveTodayState({
        now: at("2026-08-11T18:47:00"),
        lastSessionEndedAt: at("2026-08-11T18:12:00"),
        ...noLog,
      })
    ).toBe("post-session");
  });

  it("leads with the day's log in the evening once it exists", () => {
    expect(
      resolveTodayState({
        now: at("2026-08-11T21:52:00"),
        lastSessionEndedAt: at("2026-08-11T18:12:00"),
        hasDayLog: true,
      })
    ).toBe("evening");
  });

  // The two halves of the evening rule, each falsified on its own.
  it("does not go to evening after 18:00 when nothing has been logged", () => {
    expect(
      resolveTodayState({
        now: at("2026-08-11T21:52:00"),
        lastSessionEndedAt: null,
        ...noLog,
      })
    ).toBe("morning");
  });

  it("does not go to evening before 18:00 even with the day logged", () => {
    expect(
      resolveTodayState({
        now: at("2026-08-11T14:00:00"),
        lastSessionEndedAt: null,
        hasDayLog: true,
      })
    ).toBe("morning");
  });

  it("lets evening win over a still-fresh session", () => {
    expect(
      resolveTodayState({
        now: at("2026-08-11T21:00:00"),
        lastSessionEndedAt: at("2026-08-11T20:30:00"),
        hasDayLog: true,
      })
    ).toBe("evening");
  });

  it("still leads with a late ride that has not been logged", () => {
    expect(
      resolveTodayState({
        now: at("2026-08-11T22:30:00"),
        lastSessionEndedAt: at("2026-08-11T22:05:00"),
        ...noLog,
      })
    ).toBe("post-session");
  });

  // The boundary the spec singles out. Elapsed time, never a calendar day.
  it("keeps leading with a ride that ended just before midnight", () => {
    expect(
      resolveTodayState({
        now: at("2026-08-12T00:15:00"),
        lastSessionEndedAt: at("2026-08-11T23:30:00"),
        ...noLog,
      })
    ).toBe("post-session");
  });

  it("drops back to morning once the window has passed after midnight", () => {
    expect(
      resolveTodayState({
        now: at("2026-08-12T06:00:00"),
        lastSessionEndedAt: at("2026-08-11T23:30:00"),
        ...noLog,
      })
    ).toBe("morning");
  });

  it("counts a session that ended exactly at the window edge", () => {
    const now = at("2026-08-11T14:00:00");
    expect(
      resolveTodayState({
        now,
        lastSessionEndedAt: new Date(now.getTime() - POST_SESSION_WINDOW_MS),
        ...noLog,
      })
    ).toBe("post-session");
  });

  it("does not count a session one millisecond past the window", () => {
    const now = at("2026-08-11T14:00:00");
    expect(
      resolveTodayState({
        now,
        lastSessionEndedAt: new Date(
          now.getTime() - POST_SESSION_WINDOW_MS - 1
        ),
        ...noLog,
      })
    ).toBe("morning");
  });

  // A device clock ahead of the server, or a mis-stored timestamp, must not
  // make a session that has not happened yet "just landed".
  it("ignores a session dated in the future", () => {
    expect(
      resolveTodayState({
        now: at("2026-08-11T14:00:00"),
        lastSessionEndedAt: at("2026-08-11T15:00:00"),
        ...noLog,
      })
    ).toBe("morning");
  });

  it("turns evening on at exactly EVENING_HOUR, not before", () => {
    const logged = { lastSessionEndedAt: null, hasDayLog: true };
    const justBefore = at("2026-08-11T00:00:00");
    justBefore.setHours(EVENING_HOUR - 1, 59, 0, 0);
    const onTheHour = at("2026-08-11T00:00:00");
    onTheHour.setHours(EVENING_HOUR, 0, 0, 0);
    expect(resolveTodayState({ now: justBefore, ...logged })).toBe("morning");
    expect(resolveTodayState({ now: onTheHour, ...logged })).toBe("evening");
  });
});

describe("hasDayLog", () => {
  const empty = {
    energy1_10: null,
    soreness1_10: null,
    stress1_10: null,
    notes: null,
    tags: null,
  };

  // The trap this predicate exists for: intervals.icu synthesises a wellness
  // row for every calendar day back to account creation, so "a row exists"
  // is not evidence that the athlete logged anything.
  it("is false for a synthesised row with no self-reported field", () => {
    expect(hasDayLog(empty)).toBe(false);
  });

  it("is false for no row at all", () => {
    expect(hasDayLog(null)).toBe(false);
    expect(hasDayLog(undefined)).toBe(false);
  });

  it("is true for any one self-reported score", () => {
    expect(hasDayLog({ ...empty, energy1_10: 7 })).toBe(true);
    expect(hasDayLog({ ...empty, soreness1_10: 3 })).toBe(true);
    expect(hasDayLog({ ...empty, stress1_10: 4 })).toBe(true);
  });

  it("counts a zero score, which is a real answer", () => {
    expect(hasDayLog({ ...empty, stress1_10: 0 })).toBe(true);
  });

  it("is true for a note or a tag", () => {
    expect(hasDayLog({ ...empty, notes: "legs heavy" })).toBe(true);
    expect(hasDayLog({ ...empty, tags: ["☕ Caffeine"] })).toBe(true);
  });

  it("is false for whitespace-only notes and an empty tag array", () => {
    expect(hasDayLog({ ...empty, notes: "   " })).toBe(false);
    expect(hasDayLog({ ...empty, tags: [] })).toBe(false);
  });
});

describe("previewStateFrom", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns null in production no matter what the URL says", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(previewStateFrom("evening")).toBeNull();
  });

  it("resolves a known state outside production", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(previewStateFrom("evening")).toBe("evening");
    expect(previewStateFrom("post-session")).toBe("post-session");
    expect(previewStateFrom("morning")).toBe("morning");
  });

  it("rejects an unknown value and an absent one", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(previewStateFrom("bedtime")).toBeNull();
    expect(previewStateFrom(undefined)).toBeNull();
  });
});
