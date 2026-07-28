import { describe, expect, it } from "vitest";
import { projectCtl, availabilityVerdict } from "./ctl-projection";

describe("projectCtl", () => {
  it("holds CTL flat when the week's load equals CTL × 7", () => {
    expect(projectCtl(60, 60 * 7)).toBeCloseTo(60, 1);
  });

  it("falls when the week's load is below maintenance", () => {
    expect(projectCtl(60, 0)).toBeLessThan(60);
  });

  it("rises when the week's load is above maintenance", () => {
    expect(projectCtl(60, 60 * 7 * 1.5)).toBeGreaterThan(60);
  });
});

describe("availabilityVerdict", () => {
  const base = {
    currentCtl: 60,
    loadPerHour: 70,
    historyDays: 40,
    effectiveTarget: 560, // 8h at 70 load/h
  };
  // maintenance = 60 × 7 = 420 load = 6h at 70 load/h

  it("stays silent below 28 days of history", () => {
    expect(
      availabilityVerdict({ ...base, historyDays: 27, offeredMins: 60 }).kind
    ).toBe("silent");
  });

  it("stays silent with no CTL yet", () => {
    expect(
      availabilityVerdict({ ...base, currentCtl: null, offeredMins: 60 }).kind
    ).toBe("silent");
  });

  it("stays silent when load per hour is unknown or zero", () => {
    expect(
      availabilityVerdict({ ...base, loadPerHour: 0, offeredMins: 60 }).kind
    ).toBe("silent");
    expect(
      availabilityVerdict({ ...base, loadPerHour: null, offeredMins: 60 }).kind
    ).toBe("silent");
  });

  it("warns about losing fitness below maintenance", () => {
    const v = availabilityVerdict({ ...base, offeredMins: 4.5 * 60 });
    expect(v.kind).toBe("losing");
    if (v.kind === "losing") {
      expect(v.maintenanceHrs).toBeCloseTo(6, 1);
      expect(v.projectedCtl).toBeLessThan(60);
    }
  });

  it("says holding between maintenance and target", () => {
    const v = availabilityVerdict({ ...base, offeredMins: 7 * 60 });
    expect(v.kind).toBe("holding");
    if (v.kind === "holding") expect(v.targetHrs).toBeCloseTo(8, 1);
  });

  it("says nothing at or above target", () => {
    expect(availabilityVerdict({ ...base, offeredMins: 8 * 60 }).kind).toBe(
      "ok"
    );
    expect(availabilityVerdict({ ...base, offeredMins: 10 * 60 }).kind).toBe(
      "ok"
    );
  });

  it("stays silent when the target is zero or missing, rather than falsely reporting ok", () => {
    // Without this guard, targetHrs would collapse to 0 and any offer at or
    // above maintenance (6h) would read as "ok" even though no real target
    // was ever computed.
    expect(
      availabilityVerdict({ ...base, effectiveTarget: 0, offeredMins: 7 * 60 })
        .kind
    ).toBe("silent");
  });
});
