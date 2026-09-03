import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { withPurpose } from "@/lib/training-plan";
import { FuellingCard } from "./fuelling-card";
import { blockPlacement } from "@/lib/week-plan/placement";

describe("FuellingCard", () => {
  it("renders deterministic before/during/after ranges for planned sessions", () => {
    const workout = withPurpose({
      day: 0,
      sport: "Bike",
      type: "Intervals",
      durationMins: 90,
      intensity: "Z4-Z5",
      description: "threshold reps",
      placement: blockPlacement(0),
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
      placement: blockPlacement(0),
    });

    const html = renderToString(
      <FuellingCard date="2026-08-08" workouts={[workout]} bodyMassKg={null} />
    );

    expect(html).toContain("Assumptions:");
    expect(html).toContain("body mass missing");
  });

  // Task 12 per-pair ink override: the Before/During/After labels
  // (text-white/85 pre-migration) and the body copy around them
  // (text-white/75) both landed on text-ink-secondary in v0.49's token
  // migration, flattening a deliberate two-tier hierarchy. Fails if a
  // future edit puts the label and its surrounding body copy back on the
  // same ink token.
  it("keeps the Before/During/After labels a shade brighter than their body copy", () => {
    const workout = withPurpose({
      day: 0,
      sport: "Bike",
      type: "Intervals",
      durationMins: 90,
      intensity: "Z4-Z5",
      description: "threshold reps",
      placement: blockPlacement(0),
    });
    const html = renderToString(
      <FuellingCard date="2026-08-08" workouts={[workout]} bodyMassKg={72} />
    );
    const bodyWrapper = /<div class="[^"]*">\s*<p>\s*<span[^>]*>Before:/.exec(
      html
    );
    expect(bodyWrapper).not.toBeNull();
    expect(bodyWrapper![0]).toMatch(/text-ink-muted/);

    const label = /<span class="[^"]*">\s*Before:/.exec(html);
    expect(label).not.toBeNull();
    expect(label![0]).toMatch(/text-ink-secondary/);
    expect(label![0]).not.toMatch(/text-ink-muted/);
  });

  it("uses the token scale, not ad-hoc sizes or white alphas", () => {
    const workout = withPurpose({
      day: 0,
      sport: "Bike",
      type: "Intervals",
      durationMins: 90,
      intensity: "Z4-Z5",
      description: "threshold reps",
      placement: blockPlacement(0),
    });
    const html = renderToString(
      <FuellingCard date="2026-08-08" workouts={[workout]} bodyMassKg={72} />
    );
    expect(html).not.toMatch(/text-\[[\d.]+px\]/);
    expect(html).not.toMatch(/\btext-(xs|sm)\b/);
    expect(html).not.toMatch(/text-white\//);
    expect(html).not.toMatch(/bg-white\//);
    expect(html).not.toMatch(/border-white\//);
  });
});
