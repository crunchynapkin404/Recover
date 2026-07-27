import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { shouldPromptAvailability } from "./availability-prompt";

describe("shouldPromptAvailability", () => {
  it("prompts an unconfirmed open week", () => {
    expect(
      shouldPromptAvailability({
        confirmedAt: null,
        weekStart: "2026-08-03",
        today: "2026-08-03",
      })
    ).toBe(true);
  });

  it("stays quiet once the week is confirmed, changed or not", () => {
    expect(
      shouldPromptAvailability({
        confirmedAt: new Date("2026-08-03T08:00:00Z"),
        weekStart: "2026-08-03",
        today: "2026-08-04",
      })
    ).toBe(false);
  });

  it("prompts again when the confirmation belongs to an earlier week", () => {
    expect(
      shouldPromptAvailability({
        confirmedAt: new Date("2026-07-27T08:00:00Z"),
        weekStart: "2026-08-03",
        today: "2026-08-03",
      })
    ).toBe(true);
  });

  it("stops prompting once the week is more than half gone", () => {
    expect(
      shouldPromptAvailability({
        confirmedAt: null,
        weekStart: "2026-08-03",
        today: "2026-08-08",
      })
    ).toBe(false);
  });
});

describe("shouldPromptAvailability — UTC/local calendar-day boundary", () => {
  // These cases pin process.env.TZ to Europe/Amsterdam — the app
  // container's configured zone (see .env) — rather than relying on
  // whatever TZ the test runner happens to start under. Node re-reads
  // process.env.TZ on every Date computation, so flipping it per test and
  // restoring afterwards is safe. Both instants below are unambiguous UTC
  // ("Z"-suffixed), so parsing them doesn't depend on TZ; only the local
  // calendar day shouldPromptAvailability derives from them does.
  const originalTz = process.env.TZ;

  beforeEach(() => {
    process.env.TZ = "Europe/Amsterdam";
  });

  afterEach(() => {
    process.env.TZ = originalTz;
  });

  it("does not re-prompt for a confirmation just after local midnight on the week's Monday (CEST, UTC+2)", () => {
    // 2026-08-03T00:30 local Amsterdam time (CEST) is stored as the UTC
    // instant 2026-08-02T22:30:00Z — a day earlier by UTC's calendar. A
    // UTC-based confirmedYmd would read "2026-08-02", which is < the
    // "2026-08-03" weekStart, wrongly reporting the week as unconfirmed.
    expect(
      shouldPromptAvailability({
        confirmedAt: new Date("2026-08-02T22:30:00Z"),
        weekStart: "2026-08-03",
        today: "2026-08-03",
      })
    ).toBe(false);
  });

  it("does not re-prompt for a confirmation just after local midnight on the week's Monday (CET, UTC+1)", () => {
    // 2026-01-05T00:30 local Amsterdam time (CET) is stored as the UTC
    // instant 2026-01-04T23:30:00Z, again the previous UTC calendar day.
    expect(
      shouldPromptAvailability({
        confirmedAt: new Date("2026-01-04T23:30:00Z"),
        weekStart: "2026-01-05",
        today: "2026-01-05",
      })
    ).toBe(false);
  });
});
