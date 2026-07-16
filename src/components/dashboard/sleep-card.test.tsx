import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { SleepCard } from "./sleep-card";

/**
 * v0.9.0 — the card used to render a hardcoded stage breakdown (47% REM for
 * every athlete, every night) and a "22:30 – 23:00" string literal. There is
 * no stage or bed/wake data in any connected provider, so those are gone
 * rather than fixed.
 */
const base = {
  score: 82,
  duration: "7h 30m",
  debtSecs: 0,
  bedtimeAdvice: null,
  wakeTimeSet: false,
};

describe("sleep card", () => {
  it("renders no stage breakdown — there is no stage data", () => {
    const html = renderToString(<SleepCard {...base} />);
    expect(html).not.toContain("REM");
    expect(html).not.toContain("Deep");
    expect(html).not.toContain("Core");
  });

  it("renders no efficiency figure — there is no time-in-bed data", () => {
    const html = renderToString(<SleepCard {...base} />);
    expect(html).not.toContain("Efficiency");
  });

  it("shows a dash, not a number, when the provider gave no score", () => {
    const html = renderToString(<SleepCard {...base} score={null} />);
    expect(html).toContain("—");
    expect(html).not.toContain("null");
  });

  it("prompts for a wake time instead of inventing a bedtime", () => {
    const html = renderToString(<SleepCard {...base} wakeTimeSet={false} />);
    expect(html).not.toContain("22:30");
    expect(html).toContain("wake time");
  });

  it("shows the computed bedtime once a wake time exists", () => {
    const html = renderToString(
      <SleepCard {...base} wakeTimeSet bedtimeAdvice="22:45" />
    );
    expect(html).toContain("22:45");
  });

  it("reports sleep debt in hours and minutes", () => {
    const html = renderToString(<SleepCard {...base} debtSecs={12000} />);
    expect(html).toContain("3h 20m");
  });

  it("says so plainly when there is not enough sleep data", () => {
    const html = renderToString(<SleepCard {...base} debtSecs={null} />);
    expect(html).toContain("Not enough");
  });
});
