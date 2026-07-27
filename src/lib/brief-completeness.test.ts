import { describe, expect, it } from "vitest";
import {
  arrivalFromWellness,
  gapSentence,
  missingComponents,
  overnightComplete,
} from "@/lib/brief-completeness";

describe("overnightComplete", () => {
  it("requires both HRV and sleep", () => {
    expect(overnightComplete({ hrv: true, sleep: true })).toBe(true);
    expect(overnightComplete({ hrv: true, sleep: false })).toBe(false);
    expect(overnightComplete({ hrv: false, sleep: true })).toBe(false);
    expect(overnightComplete({ hrv: false, sleep: false })).toBe(false);
  });
});

describe("arrivalFromWellness", () => {
  it("maps present values to true", () => {
    expect(
      arrivalFromWellness({ hrvMs: 62, sleepSecs: 25000, sleepScore: null })
    ).toEqual({
      hrv: true,
      sleep: true,
    });
  });

  it("treats null fields as not arrived", () => {
    expect(
      arrivalFromWellness({ hrvMs: null, sleepSecs: 25000, sleepScore: null })
    ).toEqual({
      hrv: false,
      sleep: true,
    });
    expect(
      arrivalFromWellness({ hrvMs: 62, sleepSecs: null, sleepScore: null })
    ).toEqual({
      hrv: true,
      sleep: false,
    });
  });

  it("treats a missing row as nothing arrived", () => {
    expect(arrivalFromWellness(null)).toEqual({ hrv: false, sleep: false });
    expect(arrivalFromWellness(undefined)).toEqual({
      hrv: false,
      sleep: false,
    });
  });

  // A zero reading is a real measurement, not an absence — only null means
  // "not measured" in this schema.
  it("treats 0 as arrived, not missing", () => {
    expect(
      arrivalFromWellness({ hrvMs: 0, sleepSecs: 0, sleepScore: 0 })
    ).toEqual({
      hrv: true,
      sleep: true,
    });
  });

  // Fix: readiness.ts scores sleep from either source (preferring the
  // score), so arrival must recognize either source too — a provider that
  // only ever sends a sleep score (no duration) must not be gated forever.
  describe("sleep arrival from either source", () => {
    it("counts a sleep score alone as arrived, with no duration", () => {
      expect(
        arrivalFromWellness({ hrvMs: 62, sleepSecs: null, sleepScore: 78 })
      ).toEqual({ hrv: true, sleep: true });
    });

    it("counts a sleep duration alone as arrived, with no score", () => {
      expect(
        arrivalFromWellness({ hrvMs: 62, sleepSecs: 25000, sleepScore: null })
      ).toEqual({ hrv: true, sleep: true });
    });

    it("counts both present as arrived", () => {
      expect(
        arrivalFromWellness({ hrvMs: 62, sleepSecs: 25000, sleepScore: 78 })
      ).toEqual({ hrv: true, sleep: true });
    });

    it("counts neither present as not arrived", () => {
      expect(
        arrivalFromWellness({ hrvMs: 62, sleepSecs: null, sleepScore: null })
      ).toEqual({ hrv: true, sleep: false });
    });
  });
});

describe("missingComponents", () => {
  it("lists components whose score is null", () => {
    expect(
      missingComponents({ hrv: null, rhr: 62, sleep: null, form: 55 })
    ).toEqual(["hrv", "sleep"]);
  });

  it("returns an empty list when every component scored", () => {
    expect(
      missingComponents({ hrv: 48, rhr: 62, sleep: 70, form: 55 })
    ).toEqual([]);
  });

  it("treats a null/garbage componentScores as everything missing", () => {
    expect(missingComponents(null)).toEqual(["hrv", "rhr", "sleep", "form"]);
    expect(missingComponents(undefined)).toEqual([
      "hrv",
      "rhr",
      "sleep",
      "form",
    ]);
    expect(missingComponents("nonsense")).toEqual([
      "hrv",
      "rhr",
      "sleep",
      "form",
    ]);
  });

  it("treats an absent key as missing", () => {
    expect(missingComponents({ rhr: 62, form: 55 })).toEqual(["hrv", "sleep"]);
  });
});

describe("gapSentence", () => {
  const nothingArrived = { hrv: false, sleep: false };
  const allArrived = { hrv: true, sleep: true };

  it("names what is missing and what the score leans on", () => {
    const s = gapSentence(
      { hrv: null, rhr: 62, sleep: null, form: 55 },
      nothingArrived
    );
    expect(s).toContain("Incomplete picture");
    expect(s).toContain("HRV");
    expect(s).toContain("sleep");
    expect(s).toContain("missing");
    expect(s).toContain("leans on");
    expect(s).toContain("resting HR");
    expect(s).toContain("form");
  });

  it("returns null when nothing is missing", () => {
    expect(
      gapSentence({ hrv: 48, rhr: 62, sleep: 70, form: 55 }, allArrived)
    ).toBeNull();
  });

  it("says so plainly when nothing scored at all", () => {
    const s = gapSentence(null, nothingArrived);
    expect(s).toContain("Incomplete picture");
    expect(s).not.toContain("leans on");
  });

  // The new-athlete case: the reading DID arrive, it just has no baseline
  // yet. Saying "HRV is missing" here would be false.
  it("distinguishes measured-but-unbaselined from not-measured", () => {
    const s = gapSentence(
      { hrv: null, rhr: 62, sleep: null, form: 55 },
      { hrv: true, sleep: false }
    );
    expect(s).toContain("not enough history");
    expect(s).toContain("HRV");
    // sleep genuinely did not arrive, so it is reported as missing
    expect(s).toContain("missing");
  });

  it("omits the baseline clause when everything missing is genuinely absent", () => {
    const s = gapSentence(
      { hrv: null, rhr: 62, sleep: null, form: 55 },
      nothingArrived
    );
    expect(s).not.toContain("not enough history");
  });
});
