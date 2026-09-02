import { describe, expect, it } from "vitest";
import { LIBRARY } from "./library";
import {
  peakZone,
  reconcileBand,
  zoneOf,
  ZONE_UPPER_PCT_FTP,
} from "./zone-band";

const blocksOf = (id: string) => LIBRARY.find((w) => w.id === id)!.blocks;

describe("zoneOf", () => {
  it("puts each boundary in the zone it closes, not the one after", () => {
    // Upper bounds are INCLUSIVE. 75% FTP is the top of Z2, not the bottom of
    // Z3 — an off-by-one here reports every steady endurance ride as tempo.
    expect(zoneOf(55)).toBe(1);
    expect(zoneOf(56)).toBe(2);
    expect(zoneOf(75)).toBe(2);
    expect(zoneOf(76)).toBe(3);
    expect(zoneOf(90)).toBe(3);
    expect(zoneOf(91)).toBe(4);
    expect(zoneOf(105)).toBe(4);
    expect(zoneOf(106)).toBe(5);
    expect(zoneOf(120)).toBe(5);
    expect(zoneOf(121)).toBe(6);
    expect(zoneOf(150)).toBe(6);
  });

  it("has no ceiling — anything above the last boundary is Z7", () => {
    expect(zoneOf(151)).toBe(7);
    expect(zoneOf(400)).toBe(7);
  });

  it("reads its boundaries from the exported constant", () => {
    // So changing the constant cannot leave a hand-written duplicate behind.
    for (const [i, upper] of ZONE_UPPER_PCT_FTP.entries()) {
      expect(zoneOf(upper)).toBe(i + 1);
      expect(zoneOf(upper + 1)).toBe(i + 2);
    }
  });
});

describe("peakZone", () => {
  it("reads the hardest step, not the longest or the last", () => {
    // vo2-5x3's main set is 106-112% FTP behind a 50-70% warmup. Reading the
    // warmup (the LONGEST single step in some of these) or the cooldown (the
    // last) reports a VO2max session as easy riding.
    expect(peakZone(blocksOf("vo2-5x3"))).toBe(5);
  });

  it("uses the top of a step's range, not its floor", () => {
    // long-tempo's tempo block is 76-85%. Reading `lo` puts it at the very
    // bottom of Z3; reading `hi` is what the athlete is actually asked for.
    expect(peakZone(blocksOf("long-tempo-long"))).toBe(3);
  });

  it("sees inside a repeated block", () => {
    // The main set is authored once and repeated. A scan that only walked
    // repeat === 1 blocks would miss every interval in the library.
    expect(peakZone(blocksOf("vo2-15-15-a"))).toBeGreaterThanOrEqual(5);
  });
});

describe("reconcileBand", () => {
  /**
   * THE DEFECT THIS MODULE EXISTS FOR, found by opening a capture: the open
   * day read "Long · 95 min Z1-Z2" while the workout under it said "3 × 10
   * min at 76-85% FTP". The planner's literal and the library know nothing
   * about each other, so the card contradicted itself in both themes and
   * both viewports, and axe reported 0 confirmed because it is not an
   * accessibility fault.
   */
  it("widens the planned band when the workout goes above it", () => {
    expect(reconcileBand("Z1-Z2", blocksOf("long-tempo-long"))).toBe("Z1-Z3");
  });

  it("leaves a band that already covers the workout alone", () => {
    // The commonest case by far. A quality day's "Z4-Z5" already describes a
    // VO2max session, and rewriting it to the session's full span would say
    // "Z1-Z5" — true, but it would stop telling the athlete anything.
    expect(reconcileBand("Z4-Z5", blocksOf("vo2-5x3"))).toBe("Z4-Z5");
  });

  it("widens a single-zone band without inventing a range it cannot support", () => {
    expect(reconcileBand("Z3", blocksOf("long-tempo-long"))).toBe("Z3");
    expect(reconcileBand("Z1", blocksOf("long-tempo-long"))).toBe("Z1-Z3");
  });

  it("leaves a band it cannot parse exactly as it found it", () => {
    // The planner also emits "Recovery", "4x8" and "". Guessing at those
    // would be worse than leaving them: an unparsed label is still the
    // planner's own words, and this function has no mandate to reword them.
    for (const label of ["Recovery", "4x8", "", "Z1-Zx", "tempo"]) {
      expect(reconcileBand(label, blocksOf("vo2-5x3"))).toBe(label);
    }
  });

  it("reports the recovery-day openers honestly rather than hiding them", () => {
    // Pre-race openers really do contain Z4 efforts on an easy day — that is
    // what an opener IS. The label must say so rather than reading "Z1".
    expect(peakZone(blocksOf("rec-openers-25"))).toBe(4);
    expect(reconcileBand("Z1-Z2", blocksOf("rec-openers-25"))).toBe("Z1-Z4");
  });

  it("never narrows a band", () => {
    // Every library workout against every literal the planner emits: the
    // result's top is always at least the planned top. A reconcile that
    // could narrow would let a workout hide how hard the day already was.
    for (const planned of ["Z1-Z2", "Z4-Z5", "Z3", "Z4"]) {
      const plannedTop = Number(planned.slice(-1));
      for (const w of LIBRARY) {
        const out = reconcileBand(planned, w.blocks);
        expect(
          Number(out.slice(-1)),
          `${w.id} under ${planned}`
        ).toBeGreaterThanOrEqual(plannedTop);
      }
    }
  });
});
