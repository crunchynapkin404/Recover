import { describe, expect, it } from "vitest";
import {
  DEFAULT_WINDOW,
  LAST_MINUTE_OF_DAY,
  MIN_BLOCK_PX,
  NOMINAL_TRACK_PX,
  SNAP_MIN,
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
import { blockMins, validateBlocks, type AvailabilityBlock } from "./types";

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

  // NOT 24:00, which is what this test asserted when it was written and which
  // was the bug: `toClock` cannot express 1440, so a window ceiling there put
  // the window and the clock a minute apart. See "the end-of-day wall" below.
  it("widens to contain a late block, but never past 23:59", () => {
    const week = [[], [], [], [], [], [], [block("22:00", "23:30")]];
    expect(trackWindow(week).endMin).toBe(LAST_MINUTE_OF_DAY);
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
  // a phone and nobody can grab it. Everything under ~2h20m is floored — see
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

// ── Regressions found by the whole-branch review (2026-08-29) ──────────────

describe("layoutDay when a day is over-subscribed", () => {
  const trackPx = NOMINAL_TRACK_PX;

  // The docstring promises "guaranteed non-overlapping". Four legal blocks
  // whose FLOORED widths sum past the track broke that promise: the backward
  // pass clamped with Math.max(0, ...) and pulled pills on top of each other,
  // hiding one block's resize handle underneath its neighbour.
  it("never overlaps, even when the floored widths cannot all fit", () => {
    const day = [
      block("06:15", "20:15"),
      block("21:15", "21:45"),
      block("21:45", "22:00"),
      block("22:00", "22:45"),
    ];
    expect(validateBlocks(day)).toBeNull();
    const placed = layoutDay(day, trackPx, DEFAULT_WINDOW);
    for (let i = 1; i < placed.length; i++) {
      expect(placed[i].leftPx).toBeGreaterThanOrEqual(
        placed[i - 1].leftPx + placed[i - 1].widthPx - 0.001
      );
    }
    for (const p of placed) {
      expect(p.leftPx).toBeGreaterThanOrEqual(-0.001);
      expect(p.leftPx + p.widthPx).toBeLessThanOrEqual(trackPx + 0.001);
    }
  });

  it("keeps chronological order when it has to shrink to fit", () => {
    const day = Array.from({ length: 9 }, (_, i) =>
      block(toClock(6 * 60 + i * 60), toClock(6 * 60 + i * 60 + 30))
    );
    const placed = layoutDay(day, trackPx, DEFAULT_WINDOW);
    expect(placed.map((p) => p.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    for (let i = 1; i < placed.length; i++) {
      expect(placed[i].leftPx).toBeGreaterThanOrEqual(
        placed[i - 1].leftPx + placed[i - 1].widthPx - 0.001
      );
    }
  });
});

describe("the end-of-day wall", () => {
  // trackWindow rounded UP to a whole hour and could return 1440, but toClock
  // clamps to 23:59. The two clamps disagreed by a minute, so a block pushed
  // against the right wall lost a minute per commit: it slid off the 15-minute
  // grid, shrank without any resize gesture, and eventually reached
  // start === end, which validateBlocks rejects — with the bad value already
  // in the hidden input IntakeForm submits.
  it("never widens the window past the last minute a clock can express", () => {
    const week = [[block("21:30", "23:30")], [], [], [], [], [], []];
    expect(trackWindow(week).endMin).toBeLessThanOrEqual(LAST_MINUTE_OF_DAY);
  });

  it("does not erode a block held against the right wall", () => {
    const win = trackWindow([[block("21:30", "23:30")], [], [], [], [], [], []]);
    let day = [block("22:00", "23:00")];
    for (let i = 0; i < 40; i++) day = moveBlock(day, 0, 15, win);
    expect(validateBlocks(day)).toBeNull();
    expect(blockMins(day[0])).toBe(60);
    expect(day[0].mins).toBe(60);
    expect(toMins(day[0].start!) % SNAP_MIN).toBe(0);
  });

  it("keeps mins and the clock range in agreement at the wall", () => {
    const win = { startMin: 5 * 60, endMin: LAST_MINUTE_OF_DAY };
    const next = moveBlock([block("22:00", "23:00")], 0, 600, win);
    expect(next[0].mins).toBe(
      toMins(next[0].end!) - toMins(next[0].start!)
    );
  });
});

describe("addBlock against an off-grid neighbour", () => {
  // snap() rounds to NEAREST, so a candidate derived from a 10:07 end rounded
  // BACKWARDS into that neighbour, clashed, and was discarded — reporting the
  // day full while a 113-minute gap sat open, and disabling the + button.
  it("finds the gap after a neighbour whose end is off the quarter hour", () => {
    const day = [block("05:00", "10:07"), block("12:00", "23:00")];
    expect(validateBlocks(day)).toBeNull();
    const next = addBlock(day, DEFAULT_WINDOW);
    expect(next).not.toBeNull();
    const added = next![next!.length - 1];
    expect(added.start).toBe("10:15");
    expect(validateBlocks(next!)).toBeNull();
  });

  it("still refuses a day with no room", () => {
    expect(addBlock([block("05:00", "23:00")], DEFAULT_WINDOW)).toBeNull();
  });
});

describe("what the timeline is allowed to hand the server", () => {
  // parseDayBlocks re-runs validateBlocks on every day and refuses the WHOLE
  // submission if any day fails, so an invalid block cannot be persisted. But
  // validateBlocks does NOT cross-check `mins` against the clock range, so a
  // block that is accepted can still be internally inconsistent — and `mins`
  // is what a legacy reader sees. Every mutator must keep the two agreeing.
  const win = { startMin: 5 * 60, endMin: LAST_MINUTE_OF_DAY };

  function consistent(bs: AvailabilityBlock[]) {
    for (const b of bs) {
      if (b.start == null || b.end == null) continue;
      expect(b.mins).toBe(toMins(b.end) - toMins(b.start));
      expect(b.mins).toBeGreaterThan(0);
    }
    expect(validateBlocks(bs)).toBeNull();
  }

  it("keeps mins and the clock range agreeing through any move", () => {
    let day = [block("06:00", "07:30")];
    for (const d of [15, -30, 600, -600, 45, 9999, -9999]) {
      day = moveBlock(day, 0, d, win);
      consistent(day);
    }
  });

  it("keeps mins and the clock range agreeing through any resize", () => {
    let day = [block("06:00", "07:30")];
    for (const [edge, d] of [
      ["end", 15], ["end", -600], ["start", -45], ["start", 9999], ["end", 9999],
    ] as const) {
      day = resizeBlock(day, 0, edge, d, win);
      consistent(day);
    }
  });

  // A legacy duration-only block has no position, so layoutDay omits it — but
  // it is still in the array the hidden input serialises. Editing the day's
  // TIMED block must not drop it.
  it("preserves an untimed legacy block while its neighbour is edited", () => {
    const legacy: AvailabilityBlock = {
      start: null, end: null, mins: 45, energy: "easy", sports: ["Ride"],
    };
    const day: AvailabilityBlock[] = [legacy, block("18:00", "19:00")];
    expect(layoutDay(day, NOMINAL_TRACK_PX, win)).toHaveLength(1);

    const moved = moveBlock(day, 1, 60, win);
    expect(moved[0]).toEqual(legacy);
    const resized = resizeBlock(moved, 1, "end", 30, win);
    expect(resized[0]).toEqual(legacy);
    const added = addBlock(resized, win);
    expect(added![0]).toEqual(legacy);
    expect(validateBlocks(added!)).toBeNull();
  });

  it("never drops a block's sports or energy when moving or resizing it", () => {
    const day: AvailabilityBlock[] = [
      { start: "18:00", end: "19:00", mins: 60, energy: "full", sports: ["Run"] },
    ];
    for (const next of [
      moveBlock(day, 0, 30, win),
      resizeBlock(day, 0, "end", 30, win),
    ]) {
      expect(next[0].energy).toBe("full");
      expect(next[0].sports).toEqual(["Run"]);
    }
  });
});
