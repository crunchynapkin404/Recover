import { describe, it, expect, vi } from "vitest";
import {
  refreshWindowOpen,
  runWellnessRefresh,
  WELLNESS_REFRESH_DAYS,
  WELLNESS_REFRESH_END_HOUR,
  WELLNESS_REFRESH_START_HOUR,
} from "@/lib/sync/wellness-refresh";

function at(hour: number): Date {
  const d = new Date();
  d.setHours(hour, 0, 0, 0);
  return d;
}

describe("wellness refresh window", () => {
  it("is closed before the daily sync hour", () => {
    expect(refreshWindowOpen(at(WELLNESS_REFRESH_START_HOUR - 1))).toBe(false);
    expect(refreshWindowOpen(at(3))).toBe(false);
  });

  it("is open through the morning", () => {
    for (const h of [5, 7, 9, 11]) {
      expect(refreshWindowOpen(at(h)), `hour ${h}`).toBe(true);
    }
  });

  it("is closed from midday onward", () => {
    expect(refreshWindowOpen(at(WELLNESS_REFRESH_END_HOUR))).toBe(false);
    expect(refreshWindowOpen(at(18))).toBe(false);
  });

  // Sleep is attributed to the bed date: the night of Aug 1->2 lands on the
  // 2026-08-01 row, so a today-only window would never see last night.
  it("covers enough days for bed-date attribution", () => {
    expect(WELLNESS_REFRESH_DAYS).toBeGreaterThanOrEqual(2);
  });
});

describe("runWellnessRefresh", () => {
  it("no-ops outside the window without touching the fetcher", async () => {
    const fetcher = vi.fn();
    const n = await runWellnessRefresh({
      now: at(3),
      fetcher,
      userIds: ["test-wellness-refresh-user"],
    });
    expect(n).toBe(0);
    expect(fetcher).not.toHaveBeenCalled();
  });

  // The userIds scoping is a mandatory test-only safety valve: this pass runs
  // a DB-wide query AND writes a caller-injected fetcher's payload verbatim.
  // Without it, a v0.15-style test wrote fixture data into real accounts.
  it("accepts a userIds restriction", async () => {
    const fetcher = vi.fn().mockResolvedValue([]);
    const n = await runWellnessRefresh({
      now: at(7),
      fetcher,
      userIds: ["test-wellness-refresh-user-that-does-not-exist"],
    });
    expect(n).toBe(0);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
