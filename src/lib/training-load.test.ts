import { describe, expect, it } from "vitest";
import {
  activityLoad,
  dailyLoadSeries,
  dedupeActivities,
  nativeLoadMetrics,
  resolveEffectiveLoad,
  ATL_DAYS,
  CTL_DAYS,
  DURATION_TSS_PER_HOUR,
  type AthleteThresholds,
  type LoadActivity,
} from "./training-load";

const fullAthlete: AthleteThresholds = {
  ftpWatts: 250,
  maxHr: 190,
  restingHr: 50,
};
const noThresholds: AthleteThresholds = {
  ftpWatts: null,
  maxHr: null,
  restingHr: null,
};

function act(overrides: Partial<LoadActivity>): LoadActivity {
  return {
    provider: "manual",
    startDate: new Date("2026-07-01T08:00:00"),
    durationS: 3600,
    load: null,
    avgHr: null,
    avgPower: null,
    ...overrides,
  };
}

describe("activityLoad ladder", () => {
  it("provider load wins over everything", () => {
    const out = activityLoad(
      act({ load: 87, avgPower: 250, avgHr: 160 }),
      fullAthlete
    );
    expect(out).toEqual({ load: 87, source: "provider" });
  });

  it("power TSS: one hour at FTP is 100", () => {
    const out = activityLoad(act({ avgPower: 250 }), fullAthlete);
    expect(out).toEqual({ load: 100, source: "power" });
  });

  it("power TSS scales with IF squared", () => {
    // 2h at 0.8 IF → 2 × 0.64 × 100 = 128
    const out = activityLoad(
      act({ durationS: 7200, avgPower: 200 }),
      fullAthlete
    );
    expect(out).toEqual({ load: 128, source: "power" });
  });

  it("hr TSS: avgHr at 85% of HRR is threshold (100/h)", () => {
    // hrr = (169-50)/(190-50) = 0.85 → IF 1.0
    const out = activityLoad(act({ avgHr: 169 }), fullAthlete);
    expect(out).toEqual({ load: 100, source: "hr" });
  });

  it("hr intensity factor is capped so bad data cannot explode", () => {
    // avgHr at maxHr → hrr 1.0 → IF would be 1.176, capped at 1.15 → 132.2
    const out = activityLoad(act({ avgHr: 190 }), fullAthlete);
    expect(out).toEqual({ load: 132.2, source: "hr" });
  });

  it("hr below resting clamps to zero load, not negative", () => {
    const out = activityLoad(act({ avgHr: 45 }), fullAthlete);
    expect(out).toEqual({ load: 0, source: "hr" });
  });

  it("falls through hr rung without maxHr or restingHr", () => {
    const out = activityLoad(act({ avgHr: 160 }), {
      ftpWatts: null,
      maxHr: 190,
      restingHr: null,
    });
    expect(out).toEqual({ load: DURATION_TSS_PER_HOUR, source: "duration" });
  });

  it("duration fallback: hours × 40", () => {
    const out = activityLoad(act({ durationS: 5400 }), noThresholds);
    expect(out).toEqual({ load: 60, source: "duration" });
  });

  it("no duration and no provider load → null", () => {
    expect(activityLoad(act({ durationS: null }), fullAthlete)).toBeNull();
    expect(activityLoad(act({ durationS: 0 }), fullAthlete)).toBeNull();
  });

  it("zero/negative provider load is ignored, ladder continues", () => {
    const out = activityLoad(act({ load: 0 }), noThresholds);
    expect(out).toEqual({ load: DURATION_TSS_PER_HOUR, source: "duration" });
  });
});

describe("dedupeActivities", () => {
  const base = new Date("2026-07-01T08:00:00");
  const shifted = (min: number) => new Date(base.getTime() + min * 60 * 1000);

  it("drops a cross-provider duplicate, keeping the row with provider load", () => {
    const icu = act({ provider: "intervals_icu", load: 80 });
    const strava = act({ provider: "strava", startDate: shifted(2) });
    expect(dedupeActivities([strava, icu])).toEqual([icu]);
  });

  it("keeps same-provider activities even at identical times (two rides logged)", () => {
    const a = act({ provider: "manual" });
    const b = act({ provider: "manual" });
    expect(dedupeActivities([a, b])).toHaveLength(2);
  });

  it("keeps different-provider activities outside the start window", () => {
    const a = act({ provider: "intervals_icu" });
    const b = act({ provider: "strava", startDate: shifted(45) });
    expect(dedupeActivities([a, b])).toHaveLength(2);
  });

  it("keeps different-provider activities whose durations disagree", () => {
    const a = act({ provider: "intervals_icu", durationS: 3600 });
    const b = act({
      provider: "strava",
      startDate: shifted(5),
      durationS: 7200,
    });
    expect(dedupeActivities([a, b])).toHaveLength(2);
  });
});

describe("dailyLoadSeries", () => {
  it("sums activities into local-date buckets with sources", () => {
    const series = dailyLoadSeries(
      [
        act({ load: 50, startDate: new Date("2026-07-01T07:00:00") }),
        act({ startDate: new Date("2026-07-01T18:00:00") }), // duration → 40
        act({ load: 30, startDate: new Date("2026-07-03T09:00:00") }),
      ],
      noThresholds
    );
    expect(series.get("2026-07-01")).toEqual({
      load: 90,
      sources: ["provider", "duration"],
    });
    expect(series.get("2026-07-02")).toBeUndefined();
    expect(series.get("2026-07-03")).toEqual({
      load: 30,
      sources: ["provider"],
    });
  });
});

describe("nativeLoadMetrics", () => {
  it("EMA matches hand-computed values from a single session", () => {
    const byDate = nativeLoadMetrics(
      [act({ load: 84, startDate: new Date("2026-07-01T08:00:00") })],
      noThresholds,
      "2026-07-03"
    );
    // Day 1: ctl = 84/42 = 2, atl = 84/7 = 12
    expect(byDate.get("2026-07-01")).toEqual({
      ctl: 2,
      atl: 12,
      activityDays: 1,
    });
    // Day 2 (load 0): atl = 12 - 12/7 ≈ 10.3
    expect(byDate.get("2026-07-02")?.atl).toBeCloseTo(10.3, 1);
    // Decay continues day 3
    expect(byDate.get("2026-07-03")?.atl).toBeCloseTo(8.8, 1);
  });

  it("returns empty for no activities or history entirely after upToDate", () => {
    expect(nativeLoadMetrics([], noThresholds, "2026-07-03").size).toBe(0);
    const future = nativeLoadMetrics(
      [act({ startDate: new Date("2026-08-01T08:00:00") })],
      noThresholds,
      "2026-07-03"
    );
    expect(future.size).toBe(0);
  });

  it("activityDays counts distinct activity days in each day's trailing window", () => {
    const activities = [
      act({ startDate: new Date("2026-05-01T08:00:00") }), // outside 42d of upTo
      act({ startDate: new Date("2026-06-20T08:00:00") }),
      act({ startDate: new Date("2026-06-20T18:00:00") }), // same day, counts once
      act({ startDate: new Date("2026-07-01T08:00:00") }),
    ];
    const byDate = nativeLoadMetrics(activities, noThresholds, "2026-07-03");
    expect(byDate.get("2026-07-03")?.activityDays).toBe(2);
    // On May 1 itself, only May 1 is inside its own trailing window.
    expect(byDate.get("2026-05-01")?.activityDays).toBe(1);
    // 42 days later, May 1 has rolled out.
    expect(byDate.get("2026-06-19")?.activityDays).toBe(0);
  });

  it("sanity: constant daily load converges toward that load", () => {
    const activities: LoadActivity[] = [];
    for (let i = 0; i < 200; i++) {
      const d = new Date("2026-01-01T08:00:00");
      d.setDate(d.getDate() + i);
      activities.push(act({ load: 60, startDate: d }));
    }
    const byDate = nativeLoadMetrics(activities, noThresholds, "2026-07-15");
    const last = byDate.get("2026-07-15")!;
    expect(last.ctl).toBeGreaterThan(57);
    expect(last.ctl).toBeLessThanOrEqual(60);
    expect(last.atl).toBeGreaterThan(59);
    expect(last.atl).toBeLessThanOrEqual(60);
    expect(last.activityDays).toBe(42);
  });

  it("exports the conventional time constants", () => {
    expect(CTL_DAYS).toBe(42);
    expect(ATL_DAYS).toBe(7);
  });
});

describe("resolveEffectiveLoad", () => {
  const native = { ctl: 30, atl: 40, activityDays: 10 };

  it("a complete provider pair wins over native", () => {
    expect(resolveEffectiveLoad({ ctl: 50, atl: 60 }, native)).toEqual({
      ctl: 50,
      atl: 60,
      source: "provider",
    });
  });

  it("an incomplete provider pair falls through to native, never mixes", () => {
    expect(resolveEffectiveLoad({ ctl: 50, atl: null }, native)).toEqual({
      ctl: 30,
      atl: 40,
      source: "computed",
    });
  });

  it("native below the calibrating gate yields nothing", () => {
    expect(
      resolveEffectiveLoad(
        { ctl: null, atl: null },
        { ctl: 30, atl: 40, activityDays: 6 }
      )
    ).toEqual({ ctl: null, atl: null, source: null });
  });

  it("no provider and no native yields nothing", () => {
    expect(resolveEffectiveLoad({ ctl: null, atl: null }, undefined)).toEqual({
      ctl: null,
      atl: null,
      source: null,
    });
  });
});
