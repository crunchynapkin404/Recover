// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { FuellingLine, FuellingDetail } from "./fuelling-card";
import type { ScheduledWorkout } from "@/lib/week-plan/types";
import { blockPlacement } from "@/lib/week-plan/placement";

// A genuine ScheduledWorkout, not a cast past the type system. The brief's
// original fixture built `{ type, durationMins } as ScheduledWorkout` —
// `fuellingSummary`/`fuellingFromSession` also read `intensity`, so a
// fixture missing it was never exercising the real function; it was
// exercising `intensity: undefined` and getting away with it only because
// the cast hid the gap. Shape and values match
// src/lib/fuelling/summary.test.ts's `ride` fixture, which satisfies
// `ScheduledWorkout` on its own — no cast required.
const ride = (durationMins: number): ScheduledWorkout => ({
  day: 3,
  sport: "Ride",
  type: "Endurance",
  durationMins,
  intensity: "Z1-Z2",
  description: "",
  purpose: "aerobic_base",
  minEffectiveMins: 30,
  placement: blockPlacement(0),
});

// Same non-cast approach, shaped to trip the "unknown intensity" +
// "no body mass" assumptions this file's pre-split version exercised
// (git history: `FuellingCard`'s "renders assumptions when anchors are
// missing" test) — that coverage moves to FuellingDetail below since the
// body it guards moved there unchanged.
const noAnchorRun: ScheduledWorkout = {
  day: 1,
  sport: "Run",
  type: "Endurance",
  durationMins: 45,
  intensity: "",
  description: "easy run",
  purpose: "aerobic_base",
  minEffectiveMins: 30,
  placement: blockPlacement(0),
};

describe("FuellingLine", () => {
  it("renders one line and a disclosure link, not the detail", () => {
    const html = renderToString(
      <FuellingLine
        workouts={[ride(90)]}
        bodyMassKg={70}
        href="/train?sheet=fuelling&day=2026-09-04"
      />
    );
    expect(html).toContain("g carbs before");
    expect(html).toContain('data-slot="disclosure-link"');
    // The whole point: the detail is NOT in the DOM. A drawer that renders
    // its panel is costed by assistive tech and counted by the choice-load
    // measurement whether or not it is visibly open.
    expect(html).not.toContain("During:");
    expect(html).not.toContain("Assumptions:");
  });

  it("renders nothing on a day with no session", () => {
    expect(
      renderToString(<FuellingLine workouts={[]} bodyMassKg={70} href="/x" />)
    ).toBe("");
  });
});

describe("FuellingDetail", () => {
  it("still carries the full guidance the card used to show", () => {
    const html = renderToString(
      <FuellingDetail workouts={[ride(90)]} bodyMassKg={70} />
    );
    for (const label of ["Before:", "During:", "After:"]) {
      expect(html).toContain(label);
    }
    expect(html).toContain("high");
  });

  it("renders assumptions when anchors are missing", () => {
    const html = renderToString(
      <FuellingDetail workouts={[noAnchorRun]} bodyMassKg={null} />
    );

    expect(html).toContain("Assumptions:");
    expect(html).toContain("body mass missing");
  });

  // Task 12 per-pair ink override, carried over from the pre-split
  // FuellingCard test: the Before/During/After labels (text-white/85
  // pre-migration) and the body copy around them (text-white/75) both
  // landed on text-ink-secondary in v0.49's token migration, flattening a
  // deliberate two-tier hierarchy. Fails if a future edit puts the label
  // and its surrounding body copy back on the same ink token.
  it("keeps the Before/During/After labels a shade brighter than their body copy", () => {
    const html = renderToString(
      <FuellingDetail workouts={[ride(90)]} bodyMassKg={72} />
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
    const html = renderToString(
      <FuellingDetail workouts={[ride(90)]} bodyMassKg={72} />
    );
    expect(html).not.toMatch(/text-\[[\d.]+px\]/);
    expect(html).not.toMatch(/\btext-(xs|sm)\b/);
    expect(html).not.toMatch(/text-white\//);
    expect(html).not.toMatch(/bg-white\//);
    expect(html).not.toMatch(/border-white\//);
  });
});
