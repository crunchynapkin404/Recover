import { describe, expect, it } from "vitest";
import { withPurpose } from "@/lib/training-plan";
import { sessionToZwo } from "./zwo";

describe("sessionToZwo", () => {
  it("emits required zwo root shape for a cycling session", () => {
    const session = withPurpose({
      day: 0,
      sport: "Bike",
      type: "Endurance",
      durationMins: 60,
      intensity: "Z1-Z2",
      description: "steady endurance",
    });

    const out = sessionToZwo(session, { id: "wk1-mon-endurance" });
    expect(out.ok).toBe(true);
    if (!out.ok) return;

    expect(out.fileName).toBe("wk1-mon-endurance.zwo");
    expect(out.content).toContain("<workout_file>");
    expect(out.content).toContain("<name>Endurance - 60min</name>");
    expect(out.content).toContain("<workout>");
  });

  it("is deterministic for identical input", () => {
    const session = withPurpose({
      day: 1,
      sport: "Bike",
      type: "Tempo",
      durationMins: 75,
      intensity: "Z3",
      description: "tempo",
    });

    const a = sessionToZwo(session, { id: "same" });
    const b = sessionToZwo(session, { id: "same" });

    expect(a).toEqual(b);
  });

  it("returns explicit refusal for unsupported sport", () => {
    const session = withPurpose({
      day: 2,
      sport: "Run",
      type: "Tempo",
      durationMins: 50,
      intensity: "Z3",
      description: "run tempo",
    });

    const out = sessionToZwo(session, { id: "run-tempo" });
    expect(out.ok).toBe(false);
    if (out.ok) return;

    expect(out.reason).toBe("unsupported_sport");
    expect(out.message).toContain("Bike");
  });

  it("uses intensity to change mapped power for same type and duration", () => {
    const low = withPurpose({
      day: 0,
      sport: "Bike",
      type: "Tempo",
      durationMins: 60,
      intensity: "Z1-Z2",
      description: "tempo low",
    });
    const high = withPurpose({
      day: 0,
      sport: "Bike",
      type: "Tempo",
      durationMins: 60,
      intensity: "Z4-Z5",
      description: "tempo high",
    });

    const a = sessionToZwo(low, { id: "tempo-low" });
    const b = sessionToZwo(high, { id: "tempo-high" });
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (!a.ok || !b.ok) return;

    expect(a.content).toContain('Power="0.76"');
    expect(b.content).toContain('Power="0.86"');
  });

  it("covers deterministic templates for core session types", () => {
    const cases = [
      { type: "Endurance", intensity: "Z1-Z2", expectTag: "SteadyState" },
      { type: "Tempo", intensity: "Z3", expectTag: "SteadyState" },
      { type: "Intervals", intensity: "Z4-Z5", expectTag: "IntervalsT" },
      { type: "Recovery", intensity: "Recovery", expectTag: "SteadyState" },
      { type: "Brick", intensity: "Z1-Z2", expectTag: "SteadyState" },
    ] as const;

    for (const c of cases) {
      const session = withPurpose({
        day: 0,
        sport: "Bike",
        type: c.type,
        durationMins: 50,
        intensity: c.intensity,
        description: c.type,
      });
      const out = sessionToZwo(session, { id: c.type });
      expect(out.ok).toBe(true);
      if (!out.ok) continue;
      expect(out.content).toContain(c.expectTag);
    }
  });

  it("preserves total duration for intervals by block seconds", () => {
    const session = withPurpose({
      day: 0,
      sport: "Bike",
      type: "Intervals",
      durationMins: 73,
      intensity: "Z4-Z5",
      description: "duration check",
    });
    const out = sessionToZwo(session, { id: "dur-check" });
    expect(out.ok).toBe(true);
    if (!out.ok) return;

    const warm = Number(
      out.content.match(/<Warmup Duration="(\d+)"/)?.[1] ?? "0"
    );
    const cool = Number(
      out.content.match(/<Cooldown Duration="(\d+)"/)?.[1] ?? "0"
    );
    const m = out.content.match(
      /<IntervalsT Repeat="(\d+)" OnDuration="(\d+)" OffDuration="(\d+)"/
    );
    const repeat = Number(m?.[1] ?? "0");
    const on = Number(m?.[2] ?? "0");
    const off = Number(m?.[3] ?? "0");

    const total = warm + cool + repeat * (on + off);
    expect(total).toBe(73 * 60);
  });
});
