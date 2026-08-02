import { describe, it, expect } from "vitest";
import {
  DEFAULT_WELLNESS_POLL_INTERVAL_MIN,
  WELLNESS_POLL_INTERVAL_CHOICES,
  effectivePollIntervalMin,
  isPollDue,
  refreshWindowOpen,
} from "@/lib/sync/wellness-refresh";

function at(hour: number, minute = 0): Date {
  const d = new Date(2026, 7, 2, hour, minute, 0, 0);
  return d;
}

describe("effectivePollIntervalMin", () => {
  it("falls back to the app default when unset", () => {
    expect(effectivePollIntervalMin(null)).toBe(
      DEFAULT_WELLNESS_POLL_INTERVAL_MIN
    );
    expect(effectivePollIntervalMin(undefined)).toBe(
      DEFAULT_WELLNESS_POLL_INTERVAL_MIN
    );
  });

  it("honours an explicit choice", () => {
    expect(effectivePollIntervalMin(15)).toBe(15);
    expect(effectivePollIntervalMin(60)).toBe(60);
  });

  // The default must not silently increase load on a free service for
  // instances that never touch the setting.
  it("defaults to 30, matching v0.33's cadence", () => {
    expect(DEFAULT_WELLNESS_POLL_INTERVAL_MIN).toBe(30);
  });

  it("offers exactly the four supported choices", () => {
    expect(WELLNESS_POLL_INTERVAL_CHOICES).toEqual([0, 15, 30, 60]);
  });
});

describe("isPollDue", () => {
  const now = at(14, 0);

  it("is due when never polled", () => {
    expect(isPollDue(null, 15, now)).toBe(true);
  });

  it("is due only once the connection's own interval has elapsed", () => {
    expect(isPollDue(at(13, 50), 15, now)).toBe(false);
    expect(isPollDue(at(13, 44), 15, now)).toBe(true);

    // The same timestamp is not yet due at a slower cadence — the point of
    // making this per-connection rather than one global cutoff.
    expect(isPollDue(at(13, 44), 60, now)).toBe(false);
    expect(isPollDue(at(12, 59), 60, now)).toBe(true);
  });

  it("is never due when the athlete chose daily-only", () => {
    expect(isPollDue(null, 0, now)).toBe(false);
    expect(isPollDue(at(1, 0), 0, now)).toBe(false);
  });
});

describe("refreshWindowOpen", () => {
  it("covers the whole waking day, not just the morning", () => {
    // v0.33 closed at 12:00; intraday freshness needs the afternoon.
    expect(refreshWindowOpen(at(5, 0))).toBe(true);
    expect(refreshWindowOpen(at(14, 0))).toBe(true);
    expect(refreshWindowOpen(at(22, 59))).toBe(true);
  });

  it("stays quiet overnight", () => {
    expect(refreshWindowOpen(at(23, 0))).toBe(false);
    expect(refreshWindowOpen(at(3, 0))).toBe(false);
    expect(refreshWindowOpen(at(4, 59))).toBe(false);
  });
});
