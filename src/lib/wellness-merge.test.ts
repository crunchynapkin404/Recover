import { describe, expect, it } from "vitest";
import {
  mergeWellnessPatch,
  FIELD_PRIORITY,
  type WellnessPatch,
} from "./wellness-merge";

describe("mergeWellnessPatch", () => {
  it("fills empty fields and records ownership", () => {
    const { changed, fieldSources } = mergeWellnessPatch(
      {},
      null,
      "whoop",
      { hrvMs: 62, restingHr: 48 },
      "whoop"
    );
    expect(changed).toEqual({ hrvMs: 62, restingHr: 48 });
    expect(fieldSources).toEqual({ hrvMs: "whoop", restingHr: "whoop" });
  });

  it("a lower-priority source cannot overwrite a wearable's field", () => {
    const { changed, fieldSources } = mergeWellnessPatch(
      { hrvMs: 62 },
      { hrvMs: "whoop" },
      "whoop",
      { hrvMs: 55, sleepScore: 80 },
      "intervals_icu"
    );
    // hrv stays whoop's; the empty sleepScore field is intervals'.
    expect(changed).toEqual({ sleepScore: 80 });
    expect(fieldSources.hrvMs).toBe("whoop");
    expect(fieldSources.sleepScore).toBe("intervals_icu");
  });

  it("a higher-priority source takes a field over", () => {
    const { changed, fieldSources } = mergeWellnessPatch(
      { hrvMs: 55 },
      { hrvMs: "intervals_icu" },
      "intervals_icu",
      { hrvMs: 62 },
      "whoop"
    );
    expect(changed).toEqual({ hrvMs: 62 });
    expect(fieldSources.hrvMs).toBe("whoop");
  });

  it("manual always wins, and holds against later provider syncs", () => {
    const first = mergeWellnessPatch(
      { restingHr: 50 },
      { restingHr: "whoop" },
      "whoop",
      { restingHr: 47 },
      "manual"
    );
    expect(first.changed).toEqual({ restingHr: 47 });

    const second = mergeWellnessPatch(
      { restingHr: 47 },
      first.fieldSources,
      "whoop",
      { restingHr: 51 },
      "whoop"
    );
    expect(second.changed).toEqual({});
    expect(second.fieldSources.restingHr).toBe("manual");
  });

  it("same-source re-sync heals its own field (overlap window)", () => {
    const { changed } = mergeWellnessPatch(
      { sleepSecs: 25000 },
      { sleepSecs: "oura" },
      "oura",
      { sleepSecs: 26100 },
      "oura"
    );
    expect(changed).toEqual({ sleepSecs: 26100 });
  });

  it("null patch fields never erase existing data", () => {
    const { changed, fieldSources } = mergeWellnessPatch(
      { hrvMs: 62, sleepSecs: 27000 },
      { hrvMs: "whoop", sleepSecs: "whoop" },
      "whoop",
      { hrvMs: null, sleepSecs: undefined, restingHr: 48 },
      "whoop"
    );
    expect(changed).toEqual({ restingHr: 48 });
    expect(fieldSources.hrvMs).toBe("whoop");
    expect(fieldSources.sleepSecs).toBe("whoop");
  });

  it("legacy rows (no field_sources) attribute populated fields to the row source", () => {
    const { changed, fieldSources } = mergeWellnessPatch(
      { hrvMs: 55, restingHr: 49 },
      null,
      "intervals_icu",
      { hrvMs: 62 },
      "whoop"
    );
    // whoop outranks intervals for hrv → takeover; restingHr untouched.
    expect(changed).toEqual({ hrvMs: 62 });
    expect(fieldSources).toEqual({
      hrvMs: "whoop",
      restingHr: "intervals_icu",
    });
  });

  it("training-load fields accept only intervals_icu", () => {
    const wearable = mergeWellnessPatch(
      {},
      null,
      "whoop",
      { ctl: 50, atl: 40 },
      "whoop"
    );
    expect(wearable.changed).toEqual({});

    const intervals = mergeWellnessPatch(
      {},
      null,
      "intervals_icu",
      { ctl: 50, atl: 40 },
      "intervals_icu"
    );
    expect(intervals.changed).toEqual({ ctl: 50, atl: 40 });
  });

  it("withings outranks wearables on body composition but not physiology", () => {
    const body = mergeWellnessPatch(
      { weightKg: 71.2 },
      { weightKg: "whoop" },
      "whoop",
      { weightKg: 70.8 },
      "withings"
    );
    expect(body.changed).toEqual({ weightKg: 70.8 });

    const hrv = mergeWellnessPatch(
      { hrvMs: 62 },
      { hrvMs: "whoop" },
      "whoop",
      { hrvMs: 58 },
      "withings"
    );
    expect(hrv.changed).toEqual({});
  });

  it("every patch field has a declared priority ladder", () => {
    const patch: Required<WellnessPatch> = {
      hrvMs: 1,
      restingHr: 1,
      sleepSecs: 1,
      sleepScore: 1,
      sleepDeepSecs: 1,
      sleepRemSecs: 1,
      sleepLightSecs: 1,
      sleepAwakeSecs: 1,
      bedStart: new Date(),
      bedEnd: new Date(),
      tempDeviationC: 1,
      respiratoryRate: 1,
      weightKg: 1,
      bodyFatPct: 1,
      systolic: 1,
      diastolic: 1,
      ctl: 1,
      atl: 1,
      eftp: 1,
    };
    for (const key of Object.keys(patch)) {
      expect(
        FIELD_PRIORITY[key as keyof WellnessPatch],
        `missing priority for ${key}`
      ).toBeDefined();
    }
  });
});
