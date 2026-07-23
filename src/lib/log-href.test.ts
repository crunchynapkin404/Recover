import { describe, expect, it } from "vitest";
import {
  buildLogHref,
  buildTrainHref,
  type LogFilterState,
  type TrainFilterState,
} from "./log-href";

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

const TRAIN_BASE: TrainFilterState = { ...BASE, tab: "week" };

describe("buildTrainHref", () => {
  it("always names the tab", () => {
    expect(buildTrainHref(TRAIN_BASE, {})).toBe("/train?tab=week");
  });

  it("carries the sport filter across a tab switch", () => {
    const href = buildTrainHref(
      { ...TRAIN_BASE, tab: "history", sport: "Ride" },
      { tab: "fitness" }
    );
    expect(href).toContain("tab=fitness");
    expect(href).toContain("sport=Ride");
  });

  it("carries a month view back and forth across tabs", () => {
    const href = buildTrainHref(
      { ...TRAIN_BASE, tab: "history", view: "month", month: "2026-06" },
      { tab: "week" }
    );
    expect(href).toContain("tab=week");
    expect(href).toContain("view=month");
    expect(href).toContain("month=2026-06");
  });

  it("keeps a non-default range when changing tab", () => {
    const href = buildTrainHref(
      { ...TRAIN_BASE, tab: "fitness", range: 365 },
      { tab: "history" }
    );
    expect(href).toContain("tab=history");
    expect(href).toContain("range=365");
  });

  it("omits defaults so the URL stays readable", () => {
    const href = buildTrainHref(TRAIN_BASE, { tab: "fitness" });
    expect(href).toBe("/train?tab=fitness");
    expect(href).not.toContain("range=");
    expect(href).not.toContain("view=");
  });

  it("omits month unless the view is month", () => {
    const href = buildTrainHref(
      { ...TRAIN_BASE, view: "month", month: "2026-07" },
      { view: "today" }
    );
    expect(href).toContain("view=today");
    expect(href).not.toContain("month=");
  });

  it("clears the sport filter on an empty-string override", () => {
    const href = buildTrainHref({ ...TRAIN_BASE, sport: "Run" }, { sport: "" });
    expect(href).not.toContain("sport=");
  });
});
