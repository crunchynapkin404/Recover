import { describe, expect, it } from "vitest";
import {
  buildDescription,
  formatActivityDescription,
  formatPace,
  formatPrLines,
  MARKER,
  metricsFromRaw,
  normalizeIntensityPct,
  stravaIdFromRaw,
  type DescriptionInput,
} from "./strava-describer";

const FULL: DescriptionInput = {
  title: "Zwift - 3x15 Sweet Spot",
  sport: "Ride",
  load: 85,
  intensityPct: 87,
  trimp: 112.4,
  powerHrRatio: 1.58,
  decouplingPct: 3.2,
  carbsPerHour: 62.3,
  paceSecPerKm: null,
  ctl: 72.4,
  tsb: -12.3,
  ftpW: 286,
  vo2max: 52.34,
  prLines: ["594W/1m — all-time PR"],
};

describe("formatActivityDescription", () => {
  it("renders the full cycling template", () => {
    expect(formatActivityDescription(FULL)).toBe(
      [
        "🚴 Zwift - 3x15 Sweet Spot",
        "🔋 Load: TL 85 | IF 87% | TRIMP 112",
        "⚡ Efficiency: Pw:Hr 1.58 | decoupling 3.2%",
        "🍔 Carbs: ~62 g/u",
        "📈 Form: CTL 72 | TSB -12 | eFTP 286 W | VO2 52.3",
        "🚀 594W/1m — all-time PR",
      ].join("\n")
    );
  });

  it("omits null segments and whole-null lines (no N/A)", () => {
    const out = formatActivityDescription({
      ...FULL,
      trimp: null,
      powerHrRatio: null,
      decouplingPct: null,
      carbsPerHour: null,
      vo2max: null,
      prLines: [],
    });
    expect(out).toBe(
      [
        "🚴 Zwift - 3x15 Sweet Spot",
        "🔋 Load: TL 85 | IF 87%",
        "📈 Form: CTL 72 | TSB -12 | eFTP 286 W",
      ].join("\n")
    );
    expect(out).not.toContain("N/A");
  });

  it("shows pace instead of power for runs", () => {
    const out = formatActivityDescription({
      ...FULL,
      sport: "Run",
      title: "Tempo run",
      powerHrRatio: 1.02, // present but must not render for runs
      paceSecPerKm: 272,
      decouplingPct: 5,
      prLines: [],
    });
    expect(out).toContain("🏃 Tempo run");
    expect(out).toContain("⚡ Pace: 4:32/km | decoupling 5.0%");
    expect(out).not.toContain("Pw:Hr");
  });

  it("uses sport emoji and falls back to sport as title", () => {
    const minimal: DescriptionInput = {
      ...FULL,
      title: null,
      sport: "Swim",
      load: null,
      intensityPct: null,
      trimp: null,
      powerHrRatio: null,
      decouplingPct: null,
      carbsPerHour: null,
      ctl: null,
      tsb: null,
      ftpW: null,
      vo2max: null,
      prLines: [],
    };
    expect(formatActivityDescription(minimal)).toBe("🏊 Swim");
    expect(formatActivityDescription({ ...minimal, sport: "Hike" })).toBe(
      "🏔️ Hike"
    );
  });
});

describe("buildDescription", () => {
  it("appends the marker to a fresh description", () => {
    expect(buildDescription(null, "gen")).toBe("gen" + MARKER);
    expect(buildDescription("", "gen")).toBe("gen" + MARKER);
  });

  it("appends below an existing description with a separator", () => {
    expect(buildDescription("Great ride with the club", "gen")).toBe(
      "Great ride with the club\n\n---\ngen" + MARKER
    );
  });

  it("returns existing text untouched when the marker is present", () => {
    const existing = "old\n\n---\ngen" + MARKER;
    expect(buildDescription(existing, "new gen")).toBe(existing);
  });
});

describe("normalizeIntensityPct", () => {
  it("treats values ≤ 2 as fractions, larger as percents", () => {
    expect(normalizeIntensityPct(0.87)).toBe(87);
    expect(normalizeIntensityPct(87.4)).toBe(87);
    expect(normalizeIntensityPct(null)).toBeNull();
  });
});

describe("formatPace", () => {
  it("formats m:ss and rolls over seconds", () => {
    expect(formatPace(272)).toBe("4:32");
    expect(formatPace(299.6)).toBe("5:00");
    expect(formatPace(65)).toBe("1:05");
  });
});

describe("stravaIdFromRaw", () => {
  it("reads strava_id or strava_activity_id, number or string", () => {
    expect(stravaIdFromRaw({ strava_id: 123 })).toBe("123");
    expect(stravaIdFromRaw({ strava_id: "456" })).toBe("456");
    expect(stravaIdFromRaw({ strava_activity_id: "789" })).toBe("789");
    expect(
      stravaIdFromRaw({ strava_id: "https://www.strava.com/activities/42" })
    ).toBe("42");
    expect(stravaIdFromRaw({})).toBeNull();
    expect(stravaIdFromRaw(null)).toBeNull();
  });
});

describe("metricsFromRaw", () => {
  it("extracts the spec fields", () => {
    expect(
      metricsFromRaw({
        icu_training_load: 85,
        icu_intensity: 0.87,
        trimp: 112,
        power_hr_ratio: 1.58,
        hr_decoupling: 3.2,
        carbs_per_hour: 62,
        icu_ftp: 286,
        icu_vo2max_estimate: 52.3,
      })
    ).toEqual({
      load: 85,
      intensityPct: 87,
      trimp: 112,
      powerHrRatio: 1.58,
      decouplingPct: 3.2,
      carbsPerHour: 62,
      ftpW: 286,
      vo2max: 52.3,
    });
  });

  it("returns nulls for missing/garbage fields", () => {
    const m = metricsFromRaw({ icu_training_load: "85" });
    expect(m.load).toBeNull();
    expect(m.vo2max).toBeNull();
  });
});

describe("formatPrLines", () => {
  it("formats only efforts set in this activity, capped at 3", () => {
    const effort = (
      id: string,
      value: number,
      unit: string,
      label: string
    ) => ({
      label,
      sport: "Ride",
      value,
      unit,
      activityExternalId: id,
      date: "2026-07-15",
    });
    const efforts = [
      effort("i1", 594, "W", "1m"),
      effort("other", 320, "W", "20m"),
      effort("i1", 412.6, "W", "5m"),
      effort("i1", 350, "W", "10m"),
      effort("i1", 330, "W", "20m"),
    ];
    expect(formatPrLines(efforts, "i1")).toEqual([
      "594W/1m — all-time PR",
      "413W/5m — all-time PR",
      "350W/10m — all-time PR",
    ]);
    expect(formatPrLines(efforts, "nope")).toEqual([]);
  });
});
