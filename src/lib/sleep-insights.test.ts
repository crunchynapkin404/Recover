import { describe, expect, it } from "vitest";
import {
  stageBreakdown,
  sleepMidpointMins,
  sleepConsistency,
  chronotype,
  napAware,
  MIN_CONSISTENCY_NIGHTS,
  type SleepNight,
} from "./sleep-insights";

function night(overrides: Partial<SleepNight>): SleepNight {
  return {
    date: "2026-07-15",
    sleepSecs: null,
    sleepDeepSecs: null,
    sleepRemSecs: null,
    sleepLightSecs: null,
    sleepAwakeSecs: null,
    bedStart: null,
    bedEnd: null,
    ...overrides,
  };
}

// Build a night with a bed window at the given local times on/around `date`.
function nightAt(date: string, bedStart: string, bedEnd: string): SleepNight {
  return night({
    date,
    bedStart: new Date(bedStart),
    bedEnd: new Date(bedEnd),
  });
}

describe("stageBreakdown", () => {
  it("returns null without any stage data", () => {
    expect(stageBreakdown(night({ sleepSecs: 25200 }))).toBeNull();
  });

  it("computes fractions of in-bed time", () => {
    const b = stageBreakdown(
      night({
        sleepDeepSecs: 5400,
        sleepRemSecs: 5400,
        sleepLightSecs: 14400,
        sleepAwakeSecs: 1800,
      })
    )!;
    expect(b.asleepSecs).toBe(25200);
    const inBed = 25200 + 1800;
    expect(b.fractions.deep).toBeCloseTo(5400 / inBed, 5);
    expect(b.fractions.awake).toBeCloseTo(1800 / inBed, 5);
    const sum =
      b.fractions.deep +
      b.fractions.rem +
      b.fractions.light +
      b.fractions.awake;
    expect(sum).toBeCloseTo(1, 5);
  });

  it("tolerates a missing stage (treated as 0)", () => {
    const b = stageBreakdown(
      night({ sleepDeepSecs: 3600, sleepRemSecs: 3600 })
    )!;
    expect(b.lightSecs).toBe(0);
    expect(b.asleepSecs).toBe(7200);
  });
});

describe("sleepMidpointMins", () => {
  it("handles the overnight wrap (23:30→07:30 → ~03:30)", () => {
    const mid = sleepMidpointMins(
      nightAt("2026-07-15", "2026-07-14T23:30:00", "2026-07-15T07:30:00")
    );
    expect(mid).toBe(3 * 60 + 30);
  });

  it("is null without both bed edges or with a non-positive span", () => {
    expect(sleepMidpointMins(night({ bedStart: new Date() }))).toBeNull();
    expect(
      sleepMidpointMins(
        nightAt("2026-07-15", "2026-07-15T07:00:00", "2026-07-15T07:00:00")
      )
    ).toBeNull();
  });
});

describe("sleepConsistency", () => {
  it("null below the minimum nights", () => {
    const nights = Array.from({ length: MIN_CONSISTENCY_NIGHTS - 1 }, (_, i) =>
      nightAt(
        `2026-07-1${i}`,
        `2026-07-0${i}T23:00:00`,
        `2026-07-1${i}T07:00:00`
      )
    );
    expect(sleepConsistency(nights)).toBeNull();
  });

  it("scores a perfectly regular schedule ~100", () => {
    const pad = (n: number) => String(n).padStart(2, "0");
    const nights = [11, 12, 13, 14, 15, 16].map((d) =>
      nightAt(
        `2026-07-${pad(d)}`,
        `2026-07-${pad(d - 1)}T23:00:00`,
        `2026-07-${pad(d)}T07:00:00`
      )
    );
    const c = sleepConsistency(nights)!;
    expect(c.sampleNights).toBe(6);
    expect(c.score).toBeGreaterThanOrEqual(99);
    expect(c.sdMinutes).toBe(0);
  });

  it("penalizes a scattered schedule", () => {
    const bedtimes = ["21:00", "01:00", "22:30", "02:00", "20:00", "03:00"];
    const nights = bedtimes.map((t, i) => {
      const d = 10 + i;
      const startDay = t < "12:00" ? d : d - 1;
      return nightAt(
        `2026-07-${d}`,
        `2026-07-${String(startDay).padStart(2, "0")}T${t}:00`,
        `2026-07-${d}T08:00:00`
      );
    });
    const c = sleepConsistency(nights)!;
    expect(c.score).toBeLessThan(60);
  });
});

describe("chronotype", () => {
  it("splits weekday vs free day and reports social jetlag", () => {
    // Weekday wakes (Mon-Fri) at 06:30 midpoint ~02:30; weekend later.
    const nights: SleepNight[] = [
      nightAt("2026-07-13", "2026-07-12T22:30:00", "2026-07-13T06:30:00"), // Mon
      nightAt("2026-07-14", "2026-07-13T22:30:00", "2026-07-14T06:30:00"), // Tue
      nightAt("2026-07-18", "2026-07-18T01:00:00", "2026-07-18T09:00:00"), // Sat
      nightAt("2026-07-19", "2026-07-19T01:00:00", "2026-07-19T09:00:00"), // Sun
    ];
    const c = chronotype(nights)!;
    expect(c.socialJetlagMins).toBeGreaterThan(120);
    expect(c.weekdayMidpointHhMm).toBe("02:30");
    expect(c.freeDayMidpointHhMm).toBe("05:00");
  });

  it("null without enough nights on each side", () => {
    const nights = [
      nightAt("2026-07-13", "2026-07-12T22:30:00", "2026-07-13T06:30:00"),
    ];
    expect(chronotype(nights)).toBeNull();
  });
});

describe("napAware", () => {
  it("sums sessions, treating the longest as the main sleep", () => {
    const s = napAware([
      { sleepSecs: 25200 },
      { sleepSecs: 1800 },
      { sleepSecs: null },
    ])!;
    expect(s.sessions).toBe(2);
    expect(s.totalAsleepSecs).toBe(27000);
    expect(s.napSecs).toBe(1800);
  });

  it("null with no durations", () => {
    expect(napAware([{ sleepSecs: null }])).toBeNull();
  });
});
