import { describe, expect, it } from "vitest";
import {
  resolveStartStateFromInputs,
  type StartStateSource,
} from "./start-state";

function makePersisted(source: StartStateSource = "persisted") {
  return {
    startingCtl: 61.2,
    startingAtl: 55.7,
    startingTsb: 5.5,
    ctlSource: source,
    atlSource: source,
  };
}

describe("resolveStartStateFromInputs", () => {
  it("prefers persisted snapshot over every other input", () => {
    const out = resolveStartStateFromInputs({
      persisted: makePersisted(),
      wellness: { ctl: 80, atl: 70 },
      sportRolling: { ctl: 50, atl: 45, activityDays: 30 },
    });

    expect(out.ctlSource).toBe("persisted");
    expect(out.atlSource).toBe("persisted");
    expect(out.startingCtl).toBe(61.2);
    expect(out.startingAtl).toBe(55.7);
    expect(out.startingTsb).toBe(5.5);
  });

  it("uses wellness pair when no persisted snapshot exists", () => {
    const out = resolveStartStateFromInputs({
      persisted: null,
      wellness: { ctl: 72.26, atl: 64.04 },
      sportRolling: { ctl: 50, atl: 45, activityDays: 30 },
    });

    expect(out.ctlSource).toBe("wellness");
    expect(out.atlSource).toBe("wellness");
    expect(out.startingCtl).toBe(72.3);
    expect(out.startingAtl).toBe(64);
    expect(out.startingTsb).toBe(8.3);
  });

  it("falls back to sport rolling metrics when wellness is incomplete", () => {
    const out = resolveStartStateFromInputs({
      persisted: null,
      wellness: { ctl: 70, atl: null },
      sportRolling: { ctl: 41.5, atl: 46.1, activityDays: 9 },
    });

    expect(out.ctlSource).toBe("sport_rolling");
    expect(out.atlSource).toBe("sport_rolling");
    expect(out.startingCtl).toBe(41.5);
    expect(out.startingAtl).toBe(46.1);
    expect(out.startingTsb).toBe(-4.6);
    expect(out.warnings).toContain("no_wellness_load_pair");
  });

  it("uses conservative global fallback when inputs are insufficient", () => {
    const out = resolveStartStateFromInputs({
      persisted: null,
      wellness: null,
      sportRolling: { ctl: 38, atl: 45, activityDays: 2 },
    });

    expect(out.ctlSource).toBe("global_fallback");
    expect(out.atlSource).toBe("global_fallback");
    expect(out.startingCtl).toBe(30);
    expect(out.startingAtl).toBe(40);
    expect(out.startingTsb).toBe(-10);
    expect(out.warnings).toContain("no_wellness_load_pair");
    expect(out.warnings).toContain("no_sport_history");
  });
});
