import { describe, expect, it } from "vitest";
import { staleSilenceDays } from "./apple-health-card";

const NOW = new Date("2026-08-02T07:00:00Z");

function daysAgo(n: number): string {
  return new Date(NOW.getTime() - n * 86_400_000).toISOString();
}

describe("staleSilenceDays", () => {
  // The real apple_health connection sat status='active' for days after
  // Health Auto Export's paid trial ended, still reading as healthy. A push
  // connector has no failure signal — silence is the only symptom.
  it("reports the silence once a push connector has clearly stopped", () => {
    expect(staleSilenceDays(daysAgo(9), NOW)).toBe(9);
    expect(staleSilenceDays(daysAgo(3), NOW)).toBe(3);
  });

  it("stays quiet while the push is still plausibly live", () => {
    expect(staleSilenceDays(daysAgo(0), NOW)).toBeNull();
    expect(staleSilenceDays(daysAgo(1), NOW)).toBeNull();
    expect(staleSilenceDays(daysAgo(2), NOW)).toBeNull();
  });

  it("says nothing when the connector has never received anything", () => {
    expect(staleSilenceDays(null, NOW)).toBeNull();
  });

  it("does not report NaN days for an unparseable timestamp", () => {
    expect(staleSilenceDays("not-a-date", NOW)).toBeNull();
  });
});
