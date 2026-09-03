import { describe, expect, it } from "vitest";
import { baselinesSummary, formatPace } from "./baselines-summary";

describe("baselinesSummary", () => {
  it("says nothing is set when nothing is", () => {
    expect(baselinesSummary(null)).toBe("not set");
    expect(baselinesSummary(undefined)).toBe("not set");
  });

  it("states what IS set, so a closed section answers 'is this right?'", () => {
    expect(
      baselinesSummary({
        wakeTime: "06:30",
        maxHr: 185,
        ftpWatts: 250,
        thresholdPaceSecPerKm: 285,
      })
    ).toBe("wake 06:30 · max HR 185 · FTP 250 · pace 4:45/km");
  });

  // THE POINT OF THIS MODULE. Every production user counted on 2026-09-02
  // was in this state: an anchor set, the run anchor missing, and a badge
  // that read as finished. A summary listing only what is set is
  // structurally incapable of saying "not here".
  it("names the missing run anchor rather than reading as done", () => {
    expect(
      baselinesSummary({
        wakeTime: null,
        maxHr: null,
        ftpWatts: 250,
        thresholdPaceSecPerKm: null,
      })
    ).toBe("FTP 250 · no run pace");
  });

  it("names a missing FTP the same way", () => {
    expect(
      baselinesSummary({
        wakeTime: null,
        maxHr: null,
        ftpWatts: null,
        thresholdPaceSecPerKm: 285,
      })
    ).toBe("pace 4:45/km · no FTP");
  });

  it("names both gaps when only a non-anchor is set", () => {
    expect(
      baselinesSummary({
        wakeTime: "06:30",
        maxHr: null,
        ftpWatts: null,
        thresholdPaceSecPerKm: null,
      })
    ).toBe("wake 06:30 · no FTP · no run pace");
  });

  // An account with nothing at all has not yet had a chance to fill
  // anything in. Listing two absences there states a gap as a failure.
  it("does not list absences on an account with nothing set at all", () => {
    expect(
      baselinesSummary({
        wakeTime: null,
        maxHr: null,
        ftpWatts: null,
        thresholdPaceSecPerKm: null,
      })
    ).toBe("not set");
  });

  it("formats pace as mm:ss/km, because sec/km is not a pace anyone reads", () => {
    expect(formatPace(240)).toBe("4:00/km");
    expect(formatPace(285)).toBe("4:45/km");
    expect(formatPace(305)).toBe("5:05/km");
  });
});
