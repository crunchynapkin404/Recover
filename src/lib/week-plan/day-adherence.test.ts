import { describe, expect, it } from "vitest";
import { dayAdherence } from "./day-adherence";
import { weekLoadPerMin } from "./volume";

const base = {
  effectiveTarget: 700,
  materializedMins: 350, // → 2 load per minute
  plannedMins: 90,
  actualLoad: 180,
};

describe("dayAdherence", () => {
  it("scores actual load against the day's share of the week's target", () => {
    // 90 planned minutes at 2 load/min = 180 planned. 180 actual = 100%.
    const f = dayAdherence(base);
    if (!f.available) throw new Error(`expected a figure, got ${f.kind}`);
    expect(f.value.pct).toBe(100);
    expect(f.value.plannedLoad).toBe(180);
    expect(f.value.actualLoad).toBe(180);
  });

  it("reports under and over honestly rather than clamping", () => {
    // A capped percentage would tell an athlete who did double the session
    // that they did exactly the session. Nothing here acts on the number, so
    // there is no reason to flatten it.
    const under = dayAdherence({ ...base, actualLoad: 90 });
    const over = dayAdherence({ ...base, actualLoad: 360 });
    if (!under.available || !over.available)
      throw new Error("expected figures");
    expect(under.value.pct).toBe(50);
    expect(over.value.pct).toBe(200);
  });

  /**
   * THE MUTATION THIS FILE EXISTS FOR. The day's target MUST come from
   * `weekLoadPerMin`, the same rate `openWeekPlannedLoads` projects the week
   * ahead with. A second per-day derivation — dividing the week target by
   * seven, say, or by the session count — makes the day's score and the
   * week's own projection two different answers to one question, and no
   * assertion on a single fixture would notice.
   */
  it("derives the target from weekLoadPerMin, not from a rate of its own", () => {
    const rate = weekLoadPerMin({
      effectiveTarget: base.effectiveTarget,
      materializedMins: base.materializedMins,
    })!;
    const f = dayAdherence(base);
    if (!f.available) throw new Error("expected a figure");
    expect(f.value.plannedLoad).toBe(Math.round(rate * base.plannedMins));
    // And it moves with the rate: halve the week's minutes, double the rate,
    // double the day's planned load.
    const denser = dayAdherence({ ...base, materializedMins: 175 });
    if (!denser.available) throw new Error("expected a figure");
    expect(denser.value.plannedLoad).toBe(360);
  });

  it("refuses when the week has no target to share out", () => {
    const f = dayAdherence({ ...base, effectiveTarget: null });
    expect(f.available).toBe(false);
    if (f.available || f.kind !== "missing_input") return;
    expect(f.needs).toMatch(/target|week/i);
  });

  it("refuses when the week never materialized any minutes", () => {
    // weekLoadPerMin returns null for 0 or null minutes — dividing by it
    // would be Infinity, and an Infinity% adherence is worse than a refusal.
    for (const materializedMins of [null, 0]) {
      const f = dayAdherence({ ...base, materializedMins });
      expect(f.available, `materializedMins=${materializedMins}`).toBe(false);
    }
  });

  it("refuses a day with no planned minutes rather than dividing by zero", () => {
    const f = dayAdherence({ ...base, plannedMins: 0 });
    expect(f.available).toBe(false);
    if (f.available || f.kind !== "not_applicable") return;
    expect(f.why).toMatch(/nothing planned|no planned/i);
  });

  it("refuses when no load has been booked for the day yet", () => {
    // Distinct from zero: a day whose ride has not synced has NOT been
    // ridden at 0% of plan, and saying so would be a number the app cannot
    // defend. `bookWeekActuals` clears the field rather than zeroing it
    // precisely so this stays distinguishable.
    const f = dayAdherence({ ...base, actualLoad: null });
    expect(f.available).toBe(false);
    if (f.available || f.kind !== "missing_input") return;
    expect(f.needs).toMatch(/activity|load|synced/i);
  });

  it("scores a genuine zero as zero, not as missing", () => {
    const f = dayAdherence({ ...base, actualLoad: 0 });
    if (!f.available) throw new Error("a booked zero is a real answer");
    expect(f.value.pct).toBe(0);
  });

  it("states the week-rate assumption in its own words", () => {
    const f = dayAdherence(base);
    if (!f.available) throw new Error("expected a figure");
    expect(f.why).toMatch(/week/i);
    expect(f.confidence).toBeTruthy();
  });
});
