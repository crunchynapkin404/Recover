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

  it("shows the missing-input state when no metric scored the day", () => {
    const t = buildHrvTile({
      latest: { date: "2026-08-07", hrvMs: 83, hrvSdnnMs: 66 },
      metric: null,
      window7: week,
    });
    expect(t.value.available).toBe(false);
    expect(t.delta).toBeNull();
    expect(t.sparkPath).toBe("");
  });
});
