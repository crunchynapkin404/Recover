import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { BedtimeCard } from "./bedtime-card";

describe("BedtimeCard", () => {
  it("renders the bed-by time", () => {
    const html = renderToString(
      <BedtimeCard bedtime="22:45" confidence="high" />
    );
    expect(html).toContain("22:45");
  });

  it("renders nothing without a bedtime", () => {
    expect(
      renderToString(<BedtimeCard bedtime={null} confidence="high" />)
    ).toBe("");
  });

  // I2, whole-branch review 2026-08-12: page.tsx's vitals Sleep tile already
  // renders formatSleepDebt(sleepDebt.debtSecs) under the same guard, and
  // both blocks sit in BLOCK_ORDER.evening — same value, twice, one screen.
  // This card's subject is the bed-by TIME; the debt figure belongs to the
  // vital every state shows, not to this card too.
  it("never renders a debt figure — that belongs to the vitals Sleep tile", () => {
    const html = renderToString(
      <BedtimeCard bedtime="22:45" confidence="high" />
    );
    expect(html).not.toContain("debt");
  });

  it("marks a low-confidence figure", () => {
    const html = renderToString(
      <BedtimeCard bedtime="22:45" confidence="low" />
    );
    expect(html).toContain("Low confidence");
  });

  it("omits the confidence chip when confidence is not low", () => {
    const html = renderToString(
      <BedtimeCard bedtime="22:45" confidence="high" />
    );
    expect(html).not.toContain("Low confidence");
  });

  it("uses the token type and ink scales", () => {
    const html = renderToString(
      <BedtimeCard bedtime="22:45" confidence="high" />
    );
    expect(html).toContain("text-figure");
    expect(html).toMatch(/text-ink-(primary|secondary|muted)/);
    expect(html).not.toMatch(/text-white\//);
    expect(html).not.toMatch(/text-\[[\d.]+px\]/);
  });
});
