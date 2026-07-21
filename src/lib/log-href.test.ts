import { describe, expect, it } from "vitest";
import { buildLogHref, type LogFilterState } from "./log-href";

const BASE: LogFilterState = {
  view: "week",
  month: "2026-07",
  range: 90,
  sport: "",
};

describe("buildLogHref", () => {
  it("preserves view and range when only sport changes", () => {
    const href = buildLogHref(BASE, { sport: "Ride" });
    expect(href).toContain("view=week");
    expect(href).toContain("range=90");
    expect(href).toContain("sport=Ride");
  });

  it("preserves view and sport when only range changes", () => {
    const href = buildLogHref({ ...BASE, sport: "Run" }, { range: 30 });
    expect(href).toContain("view=week");
    expect(href).toContain("range=30");
    expect(href).toContain("sport=Run");
  });

  it("preserves range and sport when switching to month view", () => {
    const href = buildLogHref(
      { ...BASE, sport: "Run" },
      { view: "month", month: "2026-06" }
    );
    expect(href).toContain("view=month");
    expect(href).toContain("month=2026-06");
    expect(href).toContain("range=90");
    expect(href).toContain("sport=Run");
  });

  it("preserves month and range when picking a month-strip entry", () => {
    const href = buildLogHref(
      { ...BASE, view: "month", month: "2026-05", range: 180 },
      { view: "month", month: "2026-04" }
    );
    expect(href).toContain("month=2026-04");
    expect(href).toContain("range=180");
  });

  it("omits sport from the URL when cleared via empty string", () => {
    const href = buildLogHref({ ...BASE, sport: "Ride" }, { sport: "" });
    expect(href).not.toContain("sport=");
  });

  it("omits month from the URL when the view isn't month", () => {
    const href = buildLogHref(
      { ...BASE, view: "month", month: "2026-07" },
      { view: "week" }
    );
    expect(href).not.toContain("month=");
    expect(href).toContain("view=week");
  });
});
