// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { buildHrvTile } from "@/lib/today/hrv-tile";

const week = [
  { date: "2026-08-05", hrvMs: 95, hrvSdnnMs: 73 },
  { date: "2026-08-06", hrvMs: 78, hrvSdnnMs: 67 },
  { date: "2026-08-07", hrvMs: 83, hrvSdnnMs: 66 },
];

describe("buildHrvTile", () => {
  it("shows rMSSD with a plain label and no explanation", () => {
    const t = buildHrvTile({
      latest: { date: "2026-08-07", hrvMs: 83, hrvSdnnMs: 66 },
      metric: "rmssd",
      window7: week,
    });
    expect(t.label).toBe("HRV");
    expect(t.value).toMatchObject({ available: true, value: "83" });
    expect(t.value.available && t.value.why).toBeUndefined();
    // 7d mean of the rMSSD column: (95+78+83)/3 = 85
    expect(t.delta?.text).toContain("85");
  });

  it("labels the SDNN fallback and explains it", () => {
    const t = buildHrvTile({
      latest: { date: "2026-08-07", hrvMs: null, hrvSdnnMs: 66 },
      metric: "sdnn",
      window7: week,
    });
    expect(t.label).toBe("HRV · SDNN");
    expect(t.value).toMatchObject({ available: true, value: "66" });
    expect(t.value.available && t.value.confidence).toBe("medium");
    expect(t.value.available && t.value.why).toMatch(/rMSSD/);
    // 7d mean of the SDNN column: (73+67+66)/3 = 68.67 → 69. Never the
    // rMSSD mean of 85, which would print a fictional 22% drop.
    expect(t.delta?.text).toContain("69");
    expect(t.delta?.text).not.toContain("85");
  });

  it("still shows a real reading while the baseline is calibrating", () => {
    // hrv_metric is null both when there is no reading AND during the first
    // 14 days, when the reading is real and only the baseline is short.
    // Blanking the second case tells an athlete who measured 83 ms that
    // morning "needs an HRV reading" — false, a regression on the pre-v0.97
    // tile, and inconsistent with the RHR tile beside it, which shows its
    // value while calibrating.
    const t = buildHrvTile({
      latest: { date: "2026-08-07", hrvMs: 83, hrvSdnnMs: 66 },
      metric: null,
      window7: week,
    });
    expect(t.value).toMatchObject({ available: true, value: "83" });
    expect(t.value.available && t.value.confidence).toBe("low");
    expect(t.value.available && t.value.why).toMatch(/still learning/i);
    expect(t.delta?.text).toContain("85");
  });

  it("prefers rMSSD for display while calibrating, then SDNN", () => {
    const t = buildHrvTile({
      latest: { date: "2026-08-07", hrvMs: null, hrvSdnnMs: 66 },
      metric: null,
      window7: week,
    });
    expect(t.label).toBe("HRV · SDNN");
    expect(t.value).toMatchObject({ available: true, value: "66" });
    // Compared against the SDNN column, never the rMSSD one.
    expect(t.delta?.text).toContain("69");
  });

  it("shows the missing-input state only when there is no reading at all", () => {
    const t = buildHrvTile({
      latest: { date: "2026-08-07", hrvMs: null, hrvSdnnMs: null },
      metric: null,
      window7: week,
    });
    expect(t.value.available).toBe(false);
    expect(t.delta).toBeNull();
    expect(t.sparkPath).toBe("");
  });
});
