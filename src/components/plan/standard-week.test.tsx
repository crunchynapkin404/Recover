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
});
