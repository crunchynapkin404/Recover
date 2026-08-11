import { describe, expect, it } from "vitest";
import { resolveEffectiveHrv } from "./hrv-source";
import { MIN_BASELINE_DAYS } from "./readiness";

// Deliberately disjoint ranges: rMSSD history sits at 95-99, SDNN at 68-72.
// A resolver that picks the right metric but hands back the wrong baseline
// must fail these assertions — that is why every test checks `baseline`
// contents and not only `metric`.
const rmssdHist = (n = MIN_BASELINE_DAYS) =>
  Array.from({ length: n }, (_, i) => 95 + (i % 5));
const sdnnHist = (n = MIN_BASELINE_DAYS) =>
  Array.from({ length: n }, (_, i) => 68 + (i % 5));

describe("resolveEffectiveHrv", () => {
  it("prefers rMSSD when both are present and calibrated", () => {
    const got = resolveEffectiveHrv(
      { value: 152, baseline: rmssdHist() },
      { value: 91, baseline: sdnnHist() }
    );
    expect(got.metric).toBe("rmssd");
    expect(got.value).toBe(152);
    expect(got.baseline).toEqual(rmssdHist());
  });

  it("falls back to SDNN with the SDNN baseline when rMSSD is absent", () => {
    const got = resolveEffectiveHrv(
      { value: null, baseline: rmssdHist() },
      { value: 91, baseline: sdnnHist() }
    );
    expect(got.metric).toBe("sdnn");
    expect(got.value).toBe(91);
    expect(got.baseline).toEqual(sdnnHist());
  });

  it("falls back to SDNN when rMSSD has a value but too short a baseline", () => {
    const got = resolveEffectiveHrv(
      { value: 152, baseline: rmssdHist(MIN_BASELINE_DAYS - 1) },
      { value: 91, baseline: sdnnHist() }
    );
    expect(got.metric).toBe("sdnn");
    expect(got.baseline).toEqual(sdnnHist());
  });

  it("returns no metric when neither baseline is calibrated", () => {
    const got = resolveEffectiveHrv(
      { value: 152, baseline: rmssdHist(3) },
      { value: 91, baseline: sdnnHist(3) }
    );
    expect(got).toEqual({ value: null, baseline: [], metric: null });
  });

  it("treats a zero or negative reading as absent", () => {
    expect(
      resolveEffectiveHrv(
        { value: 0, baseline: rmssdHist() },
        { value: 91, baseline: sdnnHist() }
      ).metric
    ).toBe("sdnn");

    expect(
      resolveEffectiveHrv(
        { value: -5, baseline: rmssdHist() },
        { value: null, baseline: sdnnHist() }
      ).metric
    ).toBeNull();
  });

  it("excludes non-positive baseline entries before testing the floor", () => {
    // 13 real values + 3 zeros = 16 entries but only 13 usable, under the floor.
    const contaminated = [...rmssdHist(MIN_BASELINE_DAYS - 1), 0, 0, 0];
    const got = resolveEffectiveHrv(
      { value: 152, baseline: contaminated },
      { value: 91, baseline: sdnnHist() }
    );
    expect(got.metric).toBe("sdnn");
  });

  it("strips non-positive entries from the baseline it returns", () => {
    const got = resolveEffectiveHrv(
      { value: 152, baseline: [...rmssdHist(), 0] },
      { value: null, baseline: [] }
    );
    expect(got.metric).toBe("rmssd");
    expect(got.baseline).toEqual(rmssdHist());
  });
});
