import { describe, expect, it } from "vitest";
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
