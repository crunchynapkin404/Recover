import { describe, expect, it } from "vitest";
import { formatAvailability, formatBlock, formatBlocks } from "./format";

const b = (o = {}) => ({
  start: "18:00",
  end: "19:30",
  mins: 90,
  energy: "normal" as const,
  sports: null,
  ...o,
});

describe("formatAvailability", () => {
  it("calls zero a rest day", () => expect(formatAvailability(0)).toBe("Rest"));
  it("formats under an hour", () => expect(formatAvailability(45)).toBe("45m"));
  it("formats a mixed duration", () =>
    expect(formatAvailability(90)).toBe("1h 30m"));
});

describe("formatBlock", () => {
  it("shows the clock window and the duration", () =>
    expect(formatBlock(b())).toBe("18:00–19:30 · 1h 30m"));
  it("shows only a duration for a legacy block", () =>
    expect(formatBlock(b({ start: null, end: null, mins: 60 }))).toBe(
      "1h 00m"
    ));
});

describe("formatBlocks", () => {
  it("calls an empty day a rest day", () =>
    expect(formatBlocks([])).toBe("Rest"));
  it("joins two blocks", () =>
    expect(
      formatBlocks([b({ start: "06:30", end: "07:15", mins: 45 }), b()])
    ).toBe("06:30–07:15 · 45m + 18:00–19:30 · 1h 30m"));
});
