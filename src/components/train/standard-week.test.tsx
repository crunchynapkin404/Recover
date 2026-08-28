import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { StandardWeek } from "./standard-week";

const empty = Array.from({ length: 7 }, () => []);

describe("StandardWeek", () => {
  it("lists all seven weekdays", () => {
    const html = renderToString(
      <StandardWeek defaults={empty} sports={["Bike"]} />
    );
    for (const d of [
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
      "Sunday",
    ]) {
      expect(html).toContain(d);
    }
  });

  it("shows a rest day for a weekday with no blocks", () => {
    const html = renderToString(
      <StandardWeek defaults={empty} sports={["Bike"]} />
    );
    expect(html).toContain("Rest");
  });

  it("shows both blocks on a two-block weekday", () => {
    const defaults = empty.map((d, i) =>
      i === 2
        ? [
            {
              start: "06:30",
              end: "07:15",
              mins: 45,
              energy: "easy" as const,
              sports: null,
            },
            {
              start: "19:00",
              end: "20:00",
              mins: 60,
              energy: "full" as const,
              sports: null,
            },
          ]
        : d
    );
    const html = renderToString(
      <StandardWeek defaults={defaults} sports={["Bike"]} />
    );
    expect(html).toContain("06:30");
    expect(html).toContain("19:00");
  });

  it("totals the standard week", () => {
    const defaults = empty.map((d, i) =>
      i === 5
        ? [
            {
              start: "09:00",
              end: "12:00",
              mins: 180,
              energy: "full" as const,
              sports: null,
            },
          ]
        : d
    );
    const html = renderToString(
      <StandardWeek defaults={defaults} sports={["Bike"]} />
    );
    expect(html).toContain("3h");
  });

  it("uses the token scale, not ad-hoc sizes or white alphas", () => {
    const defaults = empty.map((d, i) =>
      i === 2
        ? [
            {
              start: "06:30",
              end: "07:15",
              mins: 45,
              energy: "easy" as const,
              sports: null,
            },
          ]
        : d
    );
    const html = renderToString(
      <StandardWeek defaults={defaults} sports={["Bike"]} />
    );
    expect(html).not.toMatch(/text-\[[\d.]+px\]/);
    expect(html).not.toMatch(/\btext-(xs|sm)\b/);
    expect(html).not.toMatch(/text-white\//);
    expect(html).not.toMatch(/bg-white\//);
    expect(html).not.toMatch(/border-white\//);
  });

  // This card now renders only inside the "plan-setup" sheet (slice 2 task
  // 2), whose own panel is bg-surface-overlay. `--glass-bg` resolves to
  // `--surface-raised`, and both equal #ffffff in light — the same "second
  // time this exact bug has shipped" collision task 1 fixed on
  // WeekRationale/EventReadiness (see week-rationale.test.tsx's identically
  // named test). `.glass` painted an invisible fill behind a bare hairline
  // there; `--surface-selected` is the token this repo built for exactly
  // this shape and stays distinct from the sheet's own fill in both themes.
  it("fills its card with surface-selected, not glass (invisible on the sheet's own white overlay)", () => {
    const html = renderToString(
      <StandardWeek defaults={empty} sports={["Bike"]} />
    );
    expect(html).toContain("bg-surface-selected");
    expect(html).not.toMatch(/\bglass\b/);
  });
});
