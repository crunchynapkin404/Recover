// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { WeeklyLoadBars } from "./weekly-load-bars";

describe("WeeklyLoadBars", () => {
  it("gives each bar's wrapper a definite height so the inline height:% resolves", () => {
    // jsdom has no layout engine, so this can't assert a rendered pixel
    // height directly. What it can catch: the wrapper needs an explicit
    // height class (h-full) because its flex-row parent uses items-end,
    // not stretch — without one, the wrapper's height is intrinsic (0, since
    // its only child is itself a % height), and a % height against a 0/auto
    // parent resolves to 0. Regression for a real bug: bars with correct
    // data and correct color rendered at 0px and were invisible.
    const html = renderToString(
      <WeeklyLoadBars data={[{ weekStart: "2026-07-06", load: 780 }]} />
    );
    expect(html).toContain("h-full");
  });
});
