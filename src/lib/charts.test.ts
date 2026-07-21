import { describe, expect, it } from "vitest";
import {
  baselineBandLinear,
  baselineBandLn,
  downsample,
  localYmd,
  rollingAvg,
  weeklyLoads,
  weeklyActivitySummaries,
  CHART_TOKENS,
  formatChartValue,
} from "./charts";

describe("downsample", () => {
  it("returns input untouched when short enough", () => {
    const v = [1, 2, null, 4];
    expect(downsample(v, 10)).toEqual(v);
  });
  it("bucket-means to the target length, null-safe", () => {
    const v = Array.from({ length: 600 }, (_, i) => (i % 50 === 0 ? null : i));
    const out = downsample(v, 300);
    expect(out.length).toBeLessThanOrEqual(300);
    // first bucket = [null, 1] -> mean of available = 1
    expect(out[0]).toBe(1);
  });
  it("all-null bucket yields null", () => {
    const v = [null, null, 1, 1];
    expect(downsample(v, 2)).toEqual([null, 1]);
  });
});

describe("baseline bands", () => {
  it("ln band round-trips exp(mean±sd)", () => {
    const { low, high } = baselineBandLn(Math.log(65), 0.1);
    expect(low).toBeCloseTo(65 * Math.exp(-0.1), 5);
    expect(high).toBeCloseTo(65 * Math.exp(0.1), 5);
  });
  it("linear band is mean±sd", () => {
    expect(baselineBandLinear(48, 2)).toEqual({ low: 46, high: 50 });
  });
});

describe("rollingAvg", () => {
  it("averages available values in the trailing window", () => {
    const out = rollingAvg([10, 20, null, 40], 2);
    expect(out[0]).toBe(10);
    expect(out[1]).toBe(15);
    expect(out[2]).toBe(20);
    expect(out[3]).toBe(40);
  });
  it("all-null window stays null", () => {
    expect(rollingAvg([null, null], 2)).toEqual([null, null]);
  });
});

describe("weeklyLoads", () => {
  it("sums by Monday-based local week, zero-fills, oldest first", () => {
    const now = new Date();
    const mondayOf = (d: Date) => {
      const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      out.setDate(out.getDate() - ((out.getDay() + 6) % 7));
      return out;
    };
    const ymd = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const thisMonday = mondayOf(now);
    const lastMonday = new Date(thisMonday);
    lastMonday.setDate(lastMonday.getDate() - 7);

    const acts = [
      { startDate: new Date(lastMonday.getTime() + 3600_000), load: 50 },
      { startDate: new Date(lastMonday.getTime() + 26 * 3600_000), load: 30 },
      { startDate: new Date(thisMonday.getTime() + 3600_000), load: 20 },
    ];
    const out = weeklyLoads(acts, 2);
    expect(out).toEqual([
      { weekStart: ymd(lastMonday), load: 80 },
      { weekStart: ymd(thisMonday), load: 20 },
    ]);
  });
});

describe("localYmd", () => {
  it("formats a local date as YYYY-MM-DD with zero padding", () => {
    expect(localYmd(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});

describe("weeklyActivitySummaries", () => {
  it("buckets load, duration, distance, and sessions by Monday week", () => {
    const now = new Date();
    const summaries = weeklyActivitySummaries(
      [
        { startDate: now, load: 50, durationS: 3600, distanceM: 30000 },
        { startDate: now, load: 30, durationS: 1800, distanceM: 10000 },
      ],
      4
    );
    expect(summaries).toHaveLength(4);
    const thisWeek = summaries.at(-1)!;
    expect(thisWeek.load).toBe(80);
    expect(thisWeek.durationS).toBe(5400);
    expect(thisWeek.distanceM).toBe(40000);
    expect(thisWeek.sessions).toBe(2);
    // trailing zero-filled weeks
    expect(summaries[0]).toMatchObject({ load: 0, sessions: 0 });
  });

  it("weeklyLoads stays consistent with the generalized helper", () => {
    const now = new Date();
    const acts = [
      { startDate: now, load: 42, durationS: null, distanceM: null },
    ];
    const loads = weeklyLoads(acts, 2);
    const summaries = weeklyActivitySummaries(acts, 2);
    expect(loads).toEqual(
      summaries.map((s) => ({ weekStart: s.weekStart, load: s.load }))
    );
  });
});

describe("CHART_TOKENS", () => {
  it("exposes one series palette shared by all charts", () => {
    expect(CHART_TOKENS.series.length).toBeGreaterThanOrEqual(3);
    expect(CHART_TOKENS.grid).toMatch(/rgba|#|oklch/);
  });

  it("exposes a band fill, dash pattern, and stroke widths", () => {
    expect(CHART_TOKENS.band).toMatch(/rgba|#|oklch/);
    expect(CHART_TOKENS.dash).toMatch(/^[\d.]+ [\d.]+$/);
    expect(CHART_TOKENS.strokeWidth.regular).toBeGreaterThan(0);
  });
});

describe("formatChartValue", () => {
  it("rounds to 0 decimals by default", () => {
    expect(formatChartValue(42.7)).toBe("43");
  });

  it("rounds to the given decimal count", () => {
    expect(formatChartValue(65.34, 1)).toBe("65.3");
  });
});
