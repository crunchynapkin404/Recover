import { describe, expect, it } from "vitest";
import {
  DEFAULT_WINDOW,
  MIN_BLOCK_PX,
  NOMINAL_TRACK_PX,
  addBlock,
  describeBlock,
  layoutDay,
  moveBlock,
  pxToMins,
  resizeBlock,
  toClock,
  toMins,
  trackWindow,
} from "./timeline";
import type { AvailabilityBlock } from "./types";

const block = (
  start: string,
  end: string,
  energy: AvailabilityBlock["energy"] = "normal"
): AvailabilityBlock => ({
  start,
  end,
  mins: toMins(end) - toMins(start),
  energy,
  sports: null,
});

describe("toMins / toClock", () => {
  it("round-trips a clock time", () => {
    expect(toClock(toMins("18:45"))).toBe("18:45");
  });

  it("clamps to the end of the day, never past it", () => {
    expect(toClock(25 * 60)).toBe("23:59");
    expect(toClock(-30)).toBe("00:00");
  });
});

describe("trackWindow", () => {
  it("is 05:00-23:00 for an ordinary week", () => {
    const week = [[block("18:00", "19:30")], [], [], [], [], [], []];
    expect(trackWindow(week)).toEqual(DEFAULT_WINDOW);
  });

  it("is 05:00-23:00 for an empty week", () => {
    expect(trackWindow([[], [], [], [], [], [], []])).toEqual(DEFAULT_WINDOW);
  });

  // Decision 1: a block outside the default window widens it for EVERY day,
  // so the seven rows keep one scale and nothing is clipped away.
  it("widens down to a whole hour to contain an early block", () => {
    const week = [[block("04:30", "05:30")], [], [], [], [], [], []];
    expect(trackWindow(week).startMin).toBe(4 * 60);
    expect(trackWindow(week).endMin).toBe(23 * 60);
  });

  it("widens up to a whole hour to contain a late block", () => {
    const week = [[], [], [], [], [], [], [block("22:00", "23:30")]];
    expect(trackWindow(week).endMin).toBe(24 * 60);
  });

  it("ignores untimed legacy blocks", () => {
    const legacy: AvailabilityBlock = {
      start: null,
      end: null,
      mins: 60,
      energy: "normal",
      sports: null,
    };
    expect(trackWindow([[legacy], [], [], [], [], [], []])).toEqual(
      DEFAULT_WINDOW
    );
  });
});

describe("layoutDay", () => {
  const trackPx = NOMINAL_TRACK_PX;

  it("places a block proportionally when it is wide enough", () => {
    // 18:00-21:00 in a 05:00-23:00 window: 13/18 of the way along, 3/18 wide.
    // 3h is 57px here, clear of the 44px floor.
    const [p] = layoutDay([block("18:00", "21:00")], trackPx, DEFAULT_WINDOW);
    expect(p.leftPx).toBeCloseTo((13 / 18) * trackPx, 5);
    expect(p.widthPx).toBeCloseTo((3 / 18) * trackPx, 5);
    expect(p.widened).toBe(false);
  });

  // The spec's first named cost, made explicit: a one-hour block is 19px on
  // a phone and nobody can grab it. Everything under 2h19m is floored — see
  // the plan's decision 5 for why that number is what it is.
  it("floors a short block to the minimum touch width and says so", () => {
    const [p] = layoutDay([block("18:00", "19:00")], trackPx, DEFAULT_WINDOW);
    expect(p.widthPx).toBe(MIN_BLOCK_PX);
    expect(p.widened).toBe(true);
  });

  it("pushes a widened block's neighbour right rather than overlapping it", () => {
    const day = [block("18:00", "19:00"), block("19:15", "20:15")];
    const [a, b] = layoutDay(day, trackPx, DEFAULT_WINDOW);
    expect(b.leftPx).toBeGreaterThanOrEqual(a.leftPx + a.widthPx);
  });

  it("keeps every block inside the track, even when they cannot all fit proportionally", () => {
    const day = [block("22:00", "22:30"), block("22:30", "23:00")];
    const placed = layoutDay(day, trackPx, DEFAULT_WINDOW);
    for (const p of placed) {
      expect(p.leftPx).toBeGreaterThanOrEqual(0);
      expect(p.leftPx + p.widthPx).toBeLessThanOrEqual(trackPx + 0.001);
    }
  });

  it("reports the index of the block it placed, in chronological order", () => {
    const day = [block("20:00", "21:00"), block("07:00", "08:00")];
    expect(layoutDay(day, trackPx, DEFAULT_WINDOW).map((p) => p.index)).toEqual([
      1, 0,
    ]);
  });

  it("skips untimed blocks entirely", () => {
    const day: AvailabilityBlock[] = [
      { start: null, end: null, mins: 60, energy: "normal", sports: null },
    ];
    expect(layoutDay(day, trackPx, DEFAULT_WINDOW)).toEqual([]);
  });
});

describe("pxToMins", () => {
  it("converts a pixel delta to minutes on the same scale", () => {
    expect(pxToMins(246, 246, DEFAULT_WINDOW)).toBe(18 * 60);
    expect(pxToMins(123, 246, DEFAULT_WINDOW)).toBe(9 * 60);
  });
});

describe("moveBlock", () => {
  it("snaps the new start to a quarter hour", () => {
    const day = [block("18:00", "19:00")];
    const next = moveBlock(day, 0, 20, DEFAULT_WINDOW);
    expect(next[0].start).toBe("18:15");
    expect(next[0].end).toBe("19:15");
  });

  it("preserves the block's duration", () => {
    const day = [block("18:00", "19:30")];
    const next = moveBlock(day, 0, 60, DEFAULT_WINDOW);
    expect(next[0].mins).toBe(90);
  });

  it("stops at the start of the window instead of leaving it", () => {
    const day = [block("05:30", "06:30")];
    const next = moveBlock(day, 0, -120, DEFAULT_WINDOW);
    expect(next[0].start).toBe("05:00");
    expect(next[0].end).toBe("06:00");
  });

  it("stops at the end of the window instead of leaving it", () => {
    const day = [block("21:30", "22:30")];
    const next = moveBlock(day, 0, 240, DEFAULT_WINDOW);
    expect(next[0].end).toBe("23:00");
  });

  // The spec: "Overlap is prevented by the drag rather than rejected
  // afterwards." validateBlocks still gets the last word on commit.
  it("stops against the next block rather than overlapping it", () => {
    const day = [block("18:00", "19:00"), block("20:00", "21:00")];
    const next = moveBlock(day, 0, 180, DEFAULT_WINDOW);
    expect(next[0].end).toBe("20:00");
    expect(next[0].start).toBe("19:00");
  });

  it("stops against the previous block rather than overlapping it", () => {
    const day = [block("18:00", "19:00"), block("20:00", "21:00")];
    const next = moveBlock(day, 1, -180, DEFAULT_WINDOW);
    expect(next[1].start).toBe("19:00");
  });

  it("leaves an untimed block alone", () => {
    const day: AvailabilityBlock[] = [
      { start: null, end: null, mins: 60, energy: "normal", sports: null },
    ];
    expect(moveBlock(day, 0, 60, DEFAULT_WINDOW)).toEqual(day);
  });
});

describe("resizeBlock", () => {
  it("moves the end edge and recomputes mins", () => {
    const day = [block("18:00", "19:00")];
    const next = resizeBlock(day, 0, "end", 30, DEFAULT_WINDOW);
    expect(next[0].end).toBe("19:30");
    expect(next[0].mins).toBe(90);
  });

  it("moves the start edge and recomputes mins", () => {
    const day = [block("18:00", "19:00")];
    const next = resizeBlock(day, 0, "start", -30, DEFAULT_WINDOW);
    expect(next[0].start).toBe("17:30");
    expect(next[0].mins).toBe(90);
  });

  it("never shrinks below one snap step", () => {
    const day = [block("18:00", "19:00")];
    const next = resizeBlock(day, 0, "end", -120, DEFAULT_WINDOW);
    expect(next[0].start).toBe("18:00");
    expect(next[0].end).toBe("18:15");
  });

  it("stops the end edge against the next block", () => {
    const day = [block("18:00", "19:00"), block("20:00", "21:00")];
    const next = resizeBlock(day, 0, "end", 180, DEFAULT_WINDOW);
    expect(next[0].end).toBe("20:00");
  });

  it("stops the start edge at the window", () => {
    const day = [block("05:15", "06:15")];
    const next = resizeBlock(day, 0, "start", -120, DEFAULT_WINDOW);
    expect(next[0].start).toBe("05:00");
  });
});

describe("addBlock", () => {
  it("puts the first block of a day at 18:00 for an hour", () => {
    const next = addBlock([], DEFAULT_WINDOW);
    expect(next).not.toBeNull();
    expect(next![0].start).toBe("18:00");
    expect(next![0].end).toBe("19:00");
    expect(next![0].energy).toBe("normal");
    expect(next![0].sports).toBeNull();
  });

  it("finds a free hour after an existing block rather than overlapping it", () => {
    const next = addBlock([block("18:00", "19:00")], DEFAULT_WINDOW);
    expect(next).not.toBeNull();
    expect(next![1].start).toBe("19:00");
    expect(next![1].end).toBe("20:00");
  });

  it("returns null when the day has no free hour left", () => {
    expect(addBlock([block("05:00", "23:00")], DEFAULT_WINDOW)).toBeNull();
  });
});

describe("describeBlock", () => {
  // The exact string the spec names as the accessible name.
  it("reads as the spec's example", () => {
    expect(describeBlock("Thursday", block("17:30", "19:45", "full"))).toBe(
      "Thursday 17:30 to 19:45, full gas"
    );
  });

  it("names easy and normal in the athlete's own words", () => {
    expect(describeBlock("Monday", block("06:00", "07:00", "easy"))).toBe(
      "Monday 06:00 to 07:00, easy"
    );
    expect(describeBlock("Monday", block("06:00", "07:00", "normal"))).toBe(
      "Monday 06:00 to 07:00, normal"
    );
  });

  it("falls back to a duration for an untimed block", () => {
    expect(
      describeBlock("Monday", {
        start: null,
        end: null,
        mins: 90,
        energy: "normal",
        sports: null,
      })
    ).toBe("Monday 1h 30m, normal");
  });
});
