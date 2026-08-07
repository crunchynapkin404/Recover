import { describe, expect, it } from "vitest";
import { fuellingInputFromSession, fuellingFromSession } from "./from-session";

describe("fuellingFromSession", () => {
  it("maps a planned session into a deterministic fuelling input", () => {
    const input = fuellingInputFromSession(
      {
        durationMins: 80,
        intensity: "Z3",
        type: "Tempo",
      },
      70
    );

    expect(input).toEqual({
      durationMins: 80,
      intensity: "Z3",
      type: "Tempo",
      bodyMassKg: 70,
    });
  });

  it("returns deterministic output for identical session inputs", () => {
    const session = {
      durationMins: 120,
      intensity: "Z1-Z2",
      type: "Endurance",
    };

    const a = fuellingFromSession(session, 68);
    const b = fuellingFromSession(session, 68);

    expect(a).toEqual(b);
  });
});
