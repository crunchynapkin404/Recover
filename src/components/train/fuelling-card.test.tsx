import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { withPurpose } from "@/lib/training-plan";
import { FuellingCard } from "./fuelling-card";

describe("FuellingCard", () => {
  it("renders deterministic before/during/after ranges for planned sessions", () => {
    const workout = withPurpose({
      day: 0,
      sport: "Bike",
      type: "Intervals",
      durationMins: 90,
      intensity: "Z4-Z5",
      description: "threshold reps",
      blockIdx: 0,
    });

    const html = renderToString(
      <FuellingCard date="2026-08-08" workouts={[workout]} bodyMassKg={72} />
    );

    expect(html).toContain("Session fuelling");
    expect(html).toContain("Before:");
    expect(html).toContain("During:");
    expect(html).toContain("After:");
    expect(html).toContain("high");
  });

  it("renders assumptions when anchors are missing", () => {
    const workout = withPurpose({
      day: 1,
      sport: "Run",
      type: "Endurance",
      durationMins: 45,
      intensity: "",
      description: "easy run",
      blockIdx: 0,
    });

    const html = renderToString(
      <FuellingCard date="2026-08-08" workouts={[workout]} bodyMassKg={null} />
    );

    expect(html).toContain("Assumptions:");
    expect(html).toContain("body mass missing");
  });
});
