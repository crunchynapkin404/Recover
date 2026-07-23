import { describe, expect, it } from "vitest";
import {
  buildDescription,
  formatActivityDescription,
  formatPace,
  formatPrLines,
  isAwaitingReview,
  MARKER,
  metricsFromRaw,
  normalizeIntensityPct,
  resolveStravaId,
  stravaIdFromRaw,
  type DescriptionInput,
} from "./strava-describer";
import {
  ALL_DESCRIPTION_FIELDS,
  type DescriptionField,
} from "./strava-description-fields";

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
  perceivedExertion: null,
  feel: null,
  review: null,
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

  it("appends the review line last when present", () => {
    const out = formatActivityDescription({
      ...FULL,
      review: "Solid steady-state effort, right in zone despite the wind.",
    });
    expect(out.split("\n").at(-1)).toBe(
      "📝 Solid steady-state effort, right in zone despite the wind."
    );
  });

  it("omits the review line when null", () => {
    expect(formatActivityDescription(FULL)).not.toContain("📝");
  });

  it("renders RPE and feel together", () => {
    const out = formatActivityDescription({
      ...FULL,
      perceivedExertion: 6,
      feel: "strong",
    });
    expect(out).toContain("💪 RPE 6/10 | felt strong");
  });

  it("renders RPE alone when feel is missing, and vice versa", () => {
    expect(
      formatActivityDescription({ ...FULL, perceivedExertion: 7, feel: null })
    ).toContain("💪 RPE 7/10");
    expect(
      formatActivityDescription({
        ...FULL,
        perceivedExertion: null,
        feel: "weak",
      })
    ).toContain("💪 felt weak");
  });

  it("omits the RPE line when both are null", () => {
    expect(formatActivityDescription(FULL)).not.toContain("💪");
  });
});

/** Every field on, with overrides — the shape the settings UI submits. */
function allOn(
  overrides: Partial<Record<DescriptionField, boolean>> = {}
): Record<DescriptionField, boolean> {
  const base = Object.fromEntries(
    ALL_DESCRIPTION_FIELDS.map((f) => [f.key, true])
  ) as Record<DescriptionField, boolean>;
  return { ...base, ...overrides };
}

describe("formatActivityDescription — field selection", () => {
  it("renders byte-identical v0.6 output when no field set is passed", () => {
    const v06 = formatActivityDescription(FULL);
    expect(formatActivityDescription(FULL, null)).toBe(v06);
    expect(formatActivityDescription(FULL, undefined)).toBe(v06);
    expect(formatActivityDescription(FULL, allOn())).toBe(v06);
  });

  it("omits a disabled field but keeps the rest of its line", () => {
    const out = formatActivityDescription(FULL, allOn({ trimp: false }));
    expect(out).toContain("🔋 Load: TL 85 | IF 87%");
    expect(out).not.toContain("TRIMP");
  });

  it("drops the whole line when every field in the group is disabled", () => {
    const out = formatActivityDescription(
      FULL,
      allOn({ load: false, intensity: false, trimp: false })
    );
    expect(out).not.toContain("🔋");
    expect(out).toContain("📈 Form:");
  });

  it("drops the header when disabled", () => {
    const out = formatActivityDescription(FULL, allOn({ header: false }));
    expect(out).not.toContain("Zwift");
    expect(out.startsWith("🔋 Load:")).toBe(true);
  });

  it("drops PR lines when disabled", () => {
    const out = formatActivityDescription(FULL, allOn({ prs: false }));
    expect(out).not.toContain("🚀");
  });

  it("honors the pace toggle on runs", () => {
    const run = { ...FULL, sport: "Run", paceSecPerKm: 272, prLines: [] };
    const out = formatActivityDescription(run, allOn({ pace: false }));
    expect(out).toContain("⚡ Pace: decoupling 3.2%");
    expect(out).not.toContain("/km");
  });

  it("returns an empty string when every field is disabled", () => {
    expect(formatActivityDescription(FULL, {})).toBe("");
  });

  it("honors the review toggle", () => {
    const withReview = { ...FULL, review: "Great effort." };
    expect(
      formatActivityDescription(withReview, allOn({ review: false }))
    ).not.toContain("📝");
    expect(formatActivityDescription(withReview, allOn())).toContain(
      "📝 Great effort."
    );
  });

  it("honors the rpe toggle", () => {
    const withRpe = { ...FULL, perceivedExertion: 6, feel: "strong" as const };
    expect(
      formatActivityDescription(withRpe, allOn({ rpe: false }))
    ).not.toContain("💪");
    expect(formatActivityDescription(withRpe, allOn())).toContain("💪");
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

describe("resolveStravaId", () => {
  it("prefers an explicit strava_id when present", () => {
    expect(
      resolveStravaId({ raw: { strava_id: 123 }, externalId: "999" })
    ).toBe("123");
  });

  it("falls back to the activity's own externalId for Strava-sourced rows intervals.icu withholds strava_id for", () => {
    expect(
      resolveStravaId({
        raw: { source: "STRAVA" },
        externalId: "19433226653",
      })
    ).toBe("19433226653");
  });

  it("returns null for a non-Strava-sourced row with no linked id", () => {
    expect(
      resolveStravaId({ raw: { source: "GARMIN_CONNECT" }, externalId: "1" })
    ).toBeNull();
    expect(resolveStravaId({ raw: {}, externalId: "1" })).toBeNull();
    expect(resolveStravaId({ raw: null, externalId: "1" })).toBeNull();
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

describe("isAwaitingReview", () => {
  const PAST = new Date(Date.now() - 3_600_000);
  const FUTURE = new Date(Date.now() + 3_600_000);

  it("waits while a debrief is outstanding and no review has posted", () => {
    expect(
      isAwaitingReview({
        debriefState: "pending",
        reviewedAt: null,
        startDate: PAST,
        raw: null,
      })
    ).toBe(true);
    expect(
      isAwaitingReview({
        debriefState: "answered",
        reviewedAt: null,
        startDate: PAST,
        raw: null,
      })
    ).toBe(true);
    expect(
      isAwaitingReview({
        debriefState: "skipped",
        reviewedAt: null,
        startDate: PAST,
        raw: null,
      })
    ).toBe(true);
    expect(
      isAwaitingReview({
        debriefState: "expired",
        reviewedAt: null,
        startDate: PAST,
        raw: null,
      })
    ).toBe(true);
  });

  it("clears once reviewedAt is set, regardless of debrief state", () => {
    expect(
      isAwaitingReview({
        debriefState: "answered",
        reviewedAt: new Date(),
        startDate: PAST,
        raw: null,
      })
    ).toBe(false);
    expect(
      isAwaitingReview({
        debriefState: "pending",
        reviewedAt: new Date(),
        startDate: PAST,
        raw: null,
      })
    ).toBe(false);
  });

  it("never waits for a non-Strava activity that was never debrief-eligible", () => {
    expect(
      isAwaitingReview({
        debriefState: null,
        reviewedAt: null,
        startDate: PAST,
        raw: null,
      })
    ).toBe(false);
  });

  it("waits for a Strava-sourced stub whose startDate is still in the future (the timezone quirk hasn't self-corrected yet)", () => {
    expect(
      isAwaitingReview({
        debriefState: null,
        reviewedAt: null,
        startDate: FUTURE,
        raw: { source: "STRAVA" },
      })
    ).toBe(true);
  });

  it("stops waiting for a Strava-sourced stub once its startDate is no longer in the future", () => {
    expect(
      isAwaitingReview({
        debriefState: null,
        reviewedAt: null,
        startDate: PAST,
        raw: { source: "STRAVA" },
      })
    ).toBe(false);
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
