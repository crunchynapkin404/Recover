import { describe, expect, it } from "vitest";
import { buildMorningPayload } from "@/lib/push";

describe("buildMorningPayload", () => {
  it("formats a full amber morning", () => {
    const p = buildMorningPayload({
      readiness: 66,
      band: "amber",
      hrvMs: 63.8,
      restingHr: 48.2,
      sleepSecs: 6.9 * 3600,
    });
    expect(p.title).toBe("Readiness 66 · Amber");
    expect(p.body).toContain("HRV 64 ms");
    expect(p.body).toContain("RHR 48");
    expect(p.body).toContain("Sleep 6.9 h");
    expect(p.body).toContain("Moderate");
    expect(p.tag).toBe("morning-readiness");
    expect(p.url).toBe("/");
  });

  it("band lines differ", () => {
    const base = {
      readiness: 80,
      hrvMs: 70,
      restingHr: 45,
      sleepSecs: 8 * 3600,
    };
    expect(buildMorningPayload({ ...base, band: "green" }).body).toContain(
      "Green light"
    );
    expect(
      buildMorningPayload({ ...base, readiness: 20, band: "red" }).body
    ).toContain("Recovery day");
  });

  it("omits missing metrics", () => {
    const p = buildMorningPayload({
      readiness: 50,
      band: "amber",
      hrvMs: null,
      restingHr: null,
      sleepSecs: null,
    });
    expect(p.body).not.toContain("HRV");
    expect(p.body).not.toContain("Sleep");
  });
});
