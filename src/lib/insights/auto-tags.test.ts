import { describe, expect, it } from "vitest";
import {
  AUTO_TAG_DOUBLE,
  AUTO_TAG_HARD,
  AUTO_TAG_LATE,
  AUTO_TAG_MORNING,
  AUTO_TAG_REST,
  deriveAutoTags,
  type ActivityLite,
} from "./auto-tags";

// Local-time construction on purpose: the engine works in server-local
// time, same convention as the week engine.
function act(iso: string, durationS = 3600, load = 50): ActivityLite {
  return { startDate: new Date(iso), durationS, load };
}

const WINDOW = { start: "2026-08-01", end: "2026-08-31" };

describe("deriveAutoTags", () => {
  it("tags a rest day for window days with no activities", () => {
    const tags = deriveAutoTags([act("2026-08-03T08:00:00")], WINDOW);
    expect(tags.get("2026-08-04")).toEqual([AUTO_TAG_REST]);
    expect(tags.get("2026-08-03")).not.toContain(AUTO_TAG_REST);
  });

  it("morning/late boundaries: <12:00 and ≥19:00 by start time", () => {
    const tags = deriveAutoTags(
      [
        act("2026-08-03T11:59:00"), // morning
        act("2026-08-04T12:00:00"), // neither
        act("2026-08-05T19:00:00"), // late
        act("2026-08-06T18:59:00"), // neither
        act("2026-08-07T07:00:00"), // both on one day:
        act("2026-08-07T20:00:00"), //   morning AND late
      ],
      WINDOW
    );
    expect(tags.get("2026-08-03")).toContain(AUTO_TAG_MORNING);
    expect(tags.get("2026-08-04")).not.toContain(AUTO_TAG_MORNING);
    expect(tags.get("2026-08-04")).not.toContain(AUTO_TAG_LATE);
    expect(tags.get("2026-08-05")).toContain(AUTO_TAG_LATE);
    expect(tags.get("2026-08-06")).not.toContain(AUTO_TAG_LATE);
    expect(tags.get("2026-08-07")).toContain(AUTO_TAG_MORNING);
    expect(tags.get("2026-08-07")).toContain(AUTO_TAG_LATE);
  });

  it("double day needs two activities of ≥20 minutes", () => {
    const tags = deriveAutoTags(
      [
        act("2026-08-03T08:00:00", 1200),
        act("2026-08-03T17:00:00", 1200), // two ≥20min → double
        act("2026-08-04T08:00:00", 1200),
        act("2026-08-04T17:00:00", 1199), // second <20min → not double
      ],
      WINDOW
    );
    expect(tags.get("2026-08-03")).toContain(AUTO_TAG_DOUBLE);
    expect(tags.get("2026-08-04")).not.toContain(AUTO_TAG_DOUBLE);
  });

  it("hard session: own P75, inclusive boundary", () => {
    // 20 training days: 15 easy (load 10) + 5 hard (load 100).
    // P75 = idx 14.25 of sorted → 10 + 0.25·(100−10) = 32.5.
    const acts: ActivityLite[] = [];
    for (let d = 1; d <= 15; d++)
      acts.push(
        act(`2026-08-${String(d).padStart(2, "0")}T08:00:00`, 3600, 10)
      );
    for (let d = 16; d <= 20; d++)
      acts.push(act(`2026-08-${d}T08:00:00`, 3600, 100));
    const tags = deriveAutoTags(acts, WINDOW);
    expect(tags.get("2026-08-16")).toContain(AUTO_TAG_HARD);
    expect(tags.get("2026-08-01")).not.toContain(AUTO_TAG_HARD);
  });

  it("hard session: exact P75 boundary point still tags (inclusive ≥)", () => {
    // 21 training days: 15 easy (load 10) + 6 with distinct loads 100..105.
    // n=21 → idx = (21−1)·0.75 = 15 exactly (no interpolation) →
    // threshold = sorted[15] = 100, which is exactly the load of
    // 2026-08-16 (the smallest of the six "hard" loads). That day's
    // dayLoad therefore equals the threshold exactly rather than
    // exceeding it — this is the case a `>=`→`>` regression would miss.
    const acts: ActivityLite[] = [];
    for (let d = 1; d <= 15; d++)
      acts.push(
        act(`2026-08-${String(d).padStart(2, "0")}T08:00:00`, 3600, 10)
      );
    const hardLoads = [100, 101, 102, 103, 104, 105];
    for (let d = 16; d <= 21; d++)
      acts.push(act(`2026-08-${d}T08:00:00`, 3600, hardLoads[d - 16]));
    const tags = deriveAutoTags(acts, WINDOW);
    expect(tags.get("2026-08-16")).toContain(AUTO_TAG_HARD);
  });

  it("calibrating silence: no hard tag under 20 training days", () => {
    const acts: ActivityLite[] = [];
    for (let d = 1; d <= 19; d++)
      acts.push(
        act(
          `2026-08-${String(d).padStart(2, "0")}T08:00:00`,
          3600,
          d === 19 ? 500 : 10
        )
      );
    const tags = deriveAutoTags(acts, WINDOW);
    expect(tags.get("2026-08-19")).not.toContain(AUTO_TAG_HARD);
  });

  it("ignores activities outside the window", () => {
    const tags = deriveAutoTags([act("2026-07-31T08:00:00")], WINDOW);
    expect(tags.get("2026-07-31")).toBeUndefined();
    expect(tags.get("2026-08-01")).toEqual([AUTO_TAG_REST]);
  });
});
