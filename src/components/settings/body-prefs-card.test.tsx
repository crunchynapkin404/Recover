// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { BodyPrefsCard } from "./body-prefs-card";

const empty = {
  wakeTime: null,
  sleepNeedSecs: 28800,
  maxHr: null,
  ftpWatts: null,
  ftpWattsIndoor: null,
  thresholdPaceSecPerKm: null,
  squatOneRmKg: null,
  benchOneRmKg: null,
  deadliftOneRmKg: null,
  overheadPressOneRmKg: null,
};

describe("BodyPrefsCard field addressing", () => {
  // The anchor fix links land on a FIELD, not a page. Without ids the
  // fragment in `/settings?open=baselines#threshold-pace` targets nothing and
  // the athlete arrives at the top of the section — which is the defect this
  // whole change exists to fix. Wrapping <label> alone cannot be linked to.
  it("gives every anchor input a stable id its label points at", () => {
    const html = renderToString(<BodyPrefsCard {...empty} />);
    for (const id of [
      "wake-time",
      "sleep-target",
      "max-hr",
      "ftp-outdoor",
      "ftp-indoor",
      "threshold-pace",
    ]) {
      expect(html).toContain(`id="${id}"`);
      expect(html).toContain(`for="${id}"`);
    }
  });

  it("addresses the strength maxes too, so the set is complete", () => {
    const html = renderToString(<BodyPrefsCard {...empty} />);
    for (const id of ["squat-1rm", "bench-1rm", "deadlift-1rm", "ohp-1rm"]) {
      expect(html).toContain(`id="${id}"`);
      expect(html).toContain(`for="${id}"`);
    }
  });
});
