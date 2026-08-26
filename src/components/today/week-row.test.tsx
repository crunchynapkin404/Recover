import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import type { DaySlot } from "@/lib/week-plan/types";
import { WeekRow } from "./week-row";

function week(): DaySlot[] {
  const statuses = [
    "completed",
    "completed",
    "adapted",
    "planned",
    "rest",
    "planned",
    "race",
  ] as const;
  return statuses.map((status, i) => ({
    date: `2026-08-${String(10 + i).padStart(2, "0")}`,
    availableBlocks: [],
    availableMins: 0,
    status,
    workouts: [],
    ...(status === "race" ? { raceName: "Gran Fondo Alpe" } : {}),
  })) as DaySlot[];
}

describe("WeekRow", () => {
  it("renders nothing without a week", () => {
    expect(
      renderToString(<WeekRow days={null} hoursDone={5.8} hoursTarget={9} />)
    ).toBe("");
    expect(
      renderToString(<WeekRow days={[]} hoursDone={5.8} hoursTarget={9} />)
    ).toBe("");
  });

  it("shows hours done against the target", () => {
    const html = renderToString(
      <WeekRow days={week()} hoursDone={5.8} hoursTarget={9} />
    );
    // React 19 inserts <!-- --> between adjacent JSX expression children —
    // `{hoursDone.toFixed(1)}h` renders as `5.8<!-- -->h`, not the literal
    // substring "5.8h". src/components/body/body-battery.test.tsx is the
    // house convention for asserting through the marker.
    expect(html).toContain("5.8<!-- -->h");
    expect(html).toContain("9");
    expect(html).toContain("target");
  });

  it("claims no target when there is none, rather than inventing a denominator", () => {
    const html = renderToString(
      <WeekRow days={week()} hoursDone={5.8} hoursTarget={null} />
    );
    expect(html).toContain("5.8<!-- -->h");
    expect(html).not.toContain("target");
    expect(html).not.toContain("behind");
    expect(html).not.toContain("on track");
  });

  it("reads behind below 90% of target and on track at or above it", () => {
    expect(
      renderToString(<WeekRow days={week()} hoursDone={5.8} hoursTarget={9} />)
    ).toContain("behind");
    expect(
      renderToString(<WeekRow days={week()} hoursDone={8.2} hoursTarget={9} />)
    ).toContain("on track");
  });

  it("treats a zero target as no target", () => {
    const html = renderToString(
      <WeekRow days={week()} hoursDone={0} hoursTarget={0} />
    );
    expect(html).not.toContain("target");
    expect(html).not.toContain("behind");
    expect(html).not.toContain("on track");
  });

  it("links into Train", () => {
    const html = renderToString(
      <WeekRow days={week()} hoursDone={5.8} hoursTarget={9} />
    );
    expect(html).toContain("/train?tab=week");
  });

  it("names the race day for screen readers", () => {
    const html = renderToString(
      <WeekRow days={week()} hoursDone={5.8} hoursTarget={9} />
    );
    expect(html).toContain("Gran Fondo Alpe");
  });

  // The row stacks: label and summary on one line, the strip full-width on
  // its own. Side by side, the strip was the flex-1 in a column whose inner
  // width tops out at 572px against the 582px the three parts need, so it
  // absorbed the whole deficit and its days spilled across the summary at
  // every desktop width (worst at lg: a 42px bubble under 173px of days).
  // A flex-col section is what makes that impossible; see week-row.tsx.
  it("stacks the strip below the summary rather than beside it", () => {
    const html = renderToString(
      <WeekRow days={week()} hoursDone={5.8} hoursTarget={9} />
    );
    expect(html).toMatch(/<section class="[^"]*\bflex-col\b[^"]*"/);
    expect(html).not.toMatch(/class="[^"]*\bflex-1\b[^"]*"/);
  });

  it("uses the token type and ink scales", () => {
    const html = renderToString(
      <WeekRow days={week()} hoursDone={5.8} hoursTarget={9} />
    );
    expect(html).toContain("text-label");
    expect(html).toMatch(/text-ink-(primary|secondary|muted)/);
    // WeekRow embeds WeekStrip, which is migrated in this same task — assert
    // one of WeekStrip's own migrated classes directly, so this test cannot
    // pass merely on WeekRow's markup while leaving the embedded strip dark.
    expect(html).toContain("bg-chart-2");
    expect(html).not.toMatch(/text-white\//);
    expect(html).not.toMatch(/bg-white\//);
    expect(html).not.toMatch(/text-\[[\d.]+px\]/);
  });
});
