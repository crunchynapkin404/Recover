import { describe, expect, it } from "vitest";
import { weeklyHoursByWeek } from "@/lib/week-plan/volume-inputs";

// weeklyHoursByWeek is the pure half of this module and is exported for
// exactly this reason: the DB half needs a database, this does not.
describe("weeklyHoursByWeek", () => {
  const iso = (d: string) => new Date(d + "T10:00:00Z");

  it("buckets activities into Monday-first weeks, oldest first", () => {
    const out = weeklyHoursByWeek(
      [
        { provider: "strava", startDate: iso("2026-07-20"), durationS: 3600 },
        { provider: "strava", startDate: iso("2026-07-21"), durationS: 3600 },
        { provider: "strava", startDate: iso("2026-07-27"), durationS: 7200 },
      ],
      new Date("2026-08-02T10:00:00Z"),
      2
    );
    expect(out).toEqual([2, 2]);
  });

  it("counts a ride synced by two providers once", () => {
    const out = weeklyHoursByWeek(
      [
        {
          provider: "intervals_icu",
          startDate: iso("2026-07-27"),
          durationS: 7200,
        },
        { provider: "strava", startDate: iso("2026-07-27"), durationS: 7200 },
      ],
      new Date("2026-08-02T10:00:00Z"),
      1
    );
    expect(out).toEqual([2]);
  });

  it("emits a zero for a week with no activity, never a gap", () => {
    const out = weeklyHoursByWeek(
      [{ provider: "strava", startDate: iso("2026-07-27"), durationS: 3600 }],
      new Date("2026-08-02T10:00:00Z"),
      3
    );
    expect(out).toHaveLength(3);
    expect(out[0]).toBe(0);
    expect(out[2]).toBe(1);
  });
});
