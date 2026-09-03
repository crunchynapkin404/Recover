import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import type { DaySlot } from "@/lib/week-plan/types";
import { SessionCard } from "./session-card";
import { blockPlacement } from "@/lib/week-plan/placement";

function slot(overrides: Partial<DaySlot> = {}): DaySlot {
  return {
    date: "2026-08-11",
    availableBlocks: [],
    availableMins: 120,
    status: "planned",
    workouts: [
      {
        day: 1,
        sport: "Ride",
        type: "Endurance",
        durationMins: 90,
        intensity: "Zone 2",
        description: "Steady aerobic, keep it conversational.",
        purpose: "aerobic_base",
        minEffectiveMins: 45,
        placement: blockPlacement(0),
      },
    ],
    ...overrides,
  } as DaySlot;
}

describe("SessionCard", () => {
  it("renders nothing without a slot", () => {
    expect(
      renderToString(
        <SessionCard slot={null} adjustmentReason={null} otherDays={[]} />
      )
    ).toBe("");
  });

  it("renders the session, its duration, intensity and description", () => {
    const html = renderToString(
      <SessionCard slot={slot()} adjustmentReason={null} otherDays={[]} />
    );
    expect(html).toContain("Endurance · 90 min");
    expect(html).toContain("Zone 2");
    expect(html).toContain("Steady aerobic, keep it conversational.");
    expect(html).toContain("Today&#x27;s session");
  });

  it("says Rest for an empty day, and offers no actions on it", () => {
    const html = renderToString(
      <SessionCard
        slot={slot({ workouts: [] })}
        adjustmentReason={null}
        otherDays={[]}
      />
    );
    expect(html).toContain("Rest");
    expect(html).not.toContain("Mark done");
  });

  it("quotes an adjustment reason verbatim", () => {
    const html = renderToString(
      <SessionCard
        slot={slot()}
        adjustmentReason="Shortened after two poor nights"
        otherDays={[]}
      />
    );
    expect(html).toContain("Shortened after two poor nights");
    expect(html).toContain("data-adjustment");
  });

  it("swaps the action row for a done line on a completed slot", () => {
    const html = renderToString(
      <SessionCard
        slot={slot({ status: "completed" })}
        adjustmentReason={null}
        otherDays={[]}
      />
    );
    expect(html).toContain("Done");
    expect(html).not.toContain("Mark done");
  });

  it("takes a custom heading for tomorrow", () => {
    const html = renderToString(
      <SessionCard
        slot={slot()}
        adjustmentReason={null}
        otherDays={[]}
        heading="Tomorrow's session"
      />
    );
    expect(html).toContain("Tomorrow&#x27;s session");
    expect(html).not.toContain("Today&#x27;s session");
  });

  it("offers no Mark done when the caller forbids it", () => {
    const html = renderToString(
      <SessionCard
        slot={slot()}
        adjustmentReason={null}
        otherDays={[]}
        heading="Tomorrow's session"
        allowMarkDone={false}
      />
    );
    expect(html).not.toContain("Mark done");
  });

  it("collapses to a one-liner in the done variant", () => {
    const html = renderToString(
      <SessionCard
        slot={slot({ status: "completed" })}
        adjustmentReason={null}
        otherDays={[]}
        variant="done"
      />
    );
    expect(html).toContain("Endurance · 90 min");
    expect(html).toContain("Done");
    expect(html).not.toContain("Steady aerobic");
    expect(html).not.toContain("Mark done");
  });

  // C1, whole-branch review 2026-08-12: page.tsx used to pick variant="done"
  // from the athlete's TIME OF DAY alone ("post-session"), not from whether
  // this slot actually finished — a 20-minute commute could make a
  // 90-minute threshold session read as "✓ Done" with no way to correct it.
  // page.tsx no longer does that (see its sessionDone block), but this
  // component checks again rather than trusting every caller to get it
  // right, since it is the one that would put the false claim on screen.
  it("does not claim Done for a planned slot even when asked for the done variant, and still offers Mark done", () => {
    const html = renderToString(
      <SessionCard
        slot={slot({ status: "planned" })}
        adjustmentReason={null}
        otherDays={[]}
        variant="done"
      />
    );
    expect(html).not.toContain("✓ Done");
    expect(html).toContain("Mark done");
    expect(html).toContain("Endurance · 90 min");
  });

  it("does not claim Done for a missed slot even when asked for the done variant", () => {
    const html = renderToString(
      <SessionCard
        slot={slot({ status: "missed" })}
        adjustmentReason={null}
        otherDays={[]}
        variant="done"
      />
    );
    expect(html).not.toContain("✓ Done");
  });

  // I5, same review: the done variant used to render nothing at all for a
  // Rest day (empty workouts), silently dropping the day from the page
  // instead of saying anything honest about it.
  it("says Rest, not nothing, for a Rest day asked for the done variant", () => {
    const html = renderToString(
      <SessionCard
        slot={slot({ workouts: [], status: "rest" })}
        adjustmentReason={null}
        otherDays={[]}
        variant="done"
      />
    );
    expect(html).toContain("Rest");
    expect(html).not.toContain("✓ Done");
  });

  // I5: the done variant used to silently drop the adjustment reason. A
  // session that was shortened or moved before it happened is still part of
  // what "done" means here, so it is now shown (compactly) rather than
  // dropped.
  it("carries the adjustment reason into the done one-liner instead of dropping it", () => {
    const html = renderToString(
      <SessionCard
        slot={slot({ status: "completed" })}
        adjustmentReason="Shortened after two poor nights"
        otherDays={[]}
        variant="done"
      />
    );
    expect(html).toContain("Shortened after two poor nights");
    expect(html).toContain("data-adjustment");
    expect(html).toContain("✓ Done");
  });

  it("shows an intensity pill per workout when a day carries two", () => {
    const two = slot({
      workouts: [
        slot().workouts[0],
        {
          ...slot().workouts[0],
          type: "Recovery",
          durationMins: 30,
          intensity: "Z1",
        },
      ],
    });
    const html = renderToString(
      <SessionCard slot={two} adjustmentReason={null} otherDays={[]} />
    );
    expect(html).toContain("Endurance · 90 min");
    expect(html).toContain("Recovery · 30 min");
    expect(html).toContain("Z1");
  });

  it("uses the token type and ink scales", () => {
    // Completed, not the default planned status: a planned slot's action row
    // renders DayActions and MarkDoneButton, both explicitly out of scope for
    // this task (see day-actions.tsx / mark-done-button.tsx) and still on the
    // old text-white/ and text-[Npx] utilities. Rendering through the "done"
    // line instead keeps this assertion scoped to SessionCard's own markup —
    // the thing this task actually migrated — rather than failing on a
    // dependency this task was told to leave alone.
    const html = renderToString(
      <SessionCard
        slot={slot({ status: "completed" })}
        adjustmentReason={null}
        otherDays={[]}
      />
    );
    expect(html).toContain("text-label");
    expect(html).toMatch(/text-ink-(primary|secondary|muted)/);
    expect(html).not.toMatch(/text-white\//);
    expect(html).not.toMatch(/text-\[[\d.]+px\]/);
  });

  it("keeps the action row wrapper off legacy borders", () => {
    const html = renderToString(
      <SessionCard slot={slot()} adjustmentReason={null} otherDays={[]} />
    );
    expect(html).toContain("border-t border-hairline pt-3");
  });
});
