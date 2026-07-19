import { describe, expect, it } from "vitest";
import {
  ADHERENCE_FLOOR,
  forecastForm,
  formOutlook,
  simulatePlanChange,
} from "./forecast";

describe("formOutlook", () => {
  it("maps TSB through the form component to bands", () => {
    expect(formOutlook(10)).toBe("green"); // 50+25=75
    expect(formOutlook(7)).toBe("green"); // 67.5
    expect(formOutlook(6)).toBe("amber"); // 65
    expect(formOutlook(-6)).toBe("amber"); // 35
    expect(formOutlook(-7)).toBe("red"); // 32.5
    expect(formOutlook(100)).toBe("green"); // clamped at 90
  });
});

describe("forecastForm", () => {
  const base = {
    today: "2026-08-24",
    targetDate: "2026-08-27",
    start: { ctl: 50, atl: 60 },
    plannedLoads: [
      { date: "2026-08-25", load: 42 },
      { date: "2026-08-26", load: 0 },
      { date: "2026-08-27", load: 20 },
    ],
    adherenceFraction: null,
    horizonEnd: "2026-08-27",
  };

  it("walks the EMA exactly (hand-computed)", () => {
    const r = forecastForm(base);
    if (r.insufficient) throw new Error("unexpected insufficient");
    // day1: ctl = 50 + (42-50)/42 = 49.8095 → 49.8; atl = 60 + (42-60)/7 = 57.4286 → 57.4
    expect(r.days[0]).toEqual({
      date: "2026-08-25",
      ctl: 49.8,
      atl: 57.4,
      tsb: -7.6,
    });
    // day2 (rest): ctl = 49.8+(0-49.8)/42 = 48.6143 → 48.6; atl = 57.4+(0-57.4)/7 = 49.2
    expect(r.days[1].ctl).toBe(48.6);
    expect(r.days[1].atl).toBe(49.2);
    expect(r.days).toHaveLength(3);
    expect(r.endDate).toBe("2026-08-27");
    expect(r.capped).toBe(false);
    expect(r.full.tsb).toBe(r.days[2].tsb);
    expect(r.full.band).toBe(formOutlook(r.days[2].tsb));
    expect(r.adherence).toBeNull();
  });

  it("adherence scenario scales loads and floors the fraction", () => {
    const r = forecastForm({ ...base, adherenceFraction: 0.2 });
    if (r.insufficient) throw new Error("unexpected insufficient");
    expect(r.adherence).not.toBeNull();
    // floored at 0.5: rest days stay 0, loaded days halve → less CTL, faster ATL drop → higher TSB
    expect(r.adherence!.tsb).toBeGreaterThan(r.full.tsb);
  });

  it("caps at the plan horizon and says so", () => {
    const r = forecastForm({
      ...base,
      targetDate: "2026-09-15",
      horizonEnd: "2026-08-27",
    });
    if (r.insufficient) throw new Error("unexpected insufficient");
    expect(r.capped).toBe(true);
    expect(r.endDate).toBe("2026-08-27");
  });

  it("null start is insufficient — never a number", () => {
    expect(forecastForm({ ...base, start: null })).toEqual({
      insufficient: true,
    });
  });

  it("exports the floor for consumers", () => {
    expect(ADHERENCE_FLOOR).toBe(0.5);
  });

  it("race-day call (no days left) still honors a supplied adherence fraction", () => {
    const r = forecastForm({
      ...base,
      targetDate: "2026-08-24", // == today: nothing left to walk
      adherenceFraction: 0.8,
    });
    if (r.insufficient) throw new Error("unexpected insufficient");
    expect(r.days).toHaveLength(0);
    expect(r.full.tsb).toBe(-10); // 50 - 60, start-derived
    expect(r.adherence).toEqual({ tsb: -10, band: r.full.band });
  });
});

describe("simulatePlanChange", () => {
  const inputs = {
    today: "2026-08-24",
    targetDate: "2026-08-30",
    start: { ctl: 50, atl: 55 },
    plannedLoads: [
      { date: "2026-08-25", load: 60 },
      { date: "2026-08-27", load: 80 },
      { date: "2026-08-29", load: 30 },
    ],
    adherenceFraction: null,
    horizonEnd: "2026-08-30",
  };

  it("moving a hard day later lowers race-day freshness", () => {
    const r = simulatePlanChange(inputs, {
      kind: "move",
      fromDate: "2026-08-27",
      toDate: "2026-08-29",
    });
    expect(r.loadDelta).toBe(0);
    expect(r.deltaTsb).not.toBeNull();
    expect(r.deltaTsb!).toBeLessThan(0); // 80 TSS lands closer to race day
  });

  it("skip removes the load and raises race-day TSB", () => {
    const r = simulatePlanChange(inputs, {
      kind: "skip",
      fromDate: "2026-08-27",
    });
    expect(r.loadDelta).toBe(-80);
    expect(r.deltaTsb!).toBeGreaterThan(0);
  });

  it("swap exchanges two days' loads", () => {
    const r = simulatePlanChange(inputs, {
      kind: "swap",
      fromDate: "2026-08-25",
      toDate: "2026-08-27",
    });
    expect(r.loadDelta).toBe(0);
    // 80 moves earlier, 60 later → slightly fresher on race day
    expect(r.deltaTsb!).toBeGreaterThan(0);
  });

  it("insufficient start propagates as null delta", () => {
    const r = simulatePlanChange(
      { ...inputs, start: null },
      { kind: "skip", fromDate: "2026-08-27" }
    );
    expect(r.deltaTsb).toBeNull();
  });
});
