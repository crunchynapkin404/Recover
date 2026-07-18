import { describe, expect, it, vi } from "vitest";
import { icuGetActivityIntervals } from "./icu-get-activity-intervals";
import type { ToolContext } from "./registry";

function ctx(connection: unknown): ToolContext {
  return {
    userId: "u1",
    db: {
      query: {
        connections: { findFirst: vi.fn(async () => connection) },
      },
    } as unknown as ToolContext["db"],
  };
}

describe("icu_get_activity_intervals", () => {
  it("errors without an active connection", async () => {
    const out = await icuGetActivityIntervals.execute(
      { activityId: "i1" },
      ctx(null)
    );
    expect(out).toEqual({ error: "No active intervals.icu connection" });
  });

  it("returns shaped intervals with a work/recovery summary", async () => {
    const conn = {
      status: "active",
      encryptedAccessToken: "x",
      externalAthleteId: "i1",
    };
    const mod = await import("@/lib/connectors/intervals");
    // Response is wrapped {icu_intervals:[...]} per IntervalsDTO
    // (openapi-spec.json), field names per its Interval schema.
    const spy = vi.spyOn(mod, "icuRequest").mockResolvedValue({
      id: "a1",
      icu_intervals: [
        {
          id: 1,
          type: "WORK",
          elapsed_time: 600,
          distance: 5000,
          average_watts: 280,
          weighted_average_watts: 285,
          average_heartrate: 160,
          max_heartrate: 175,
          average_cadence: 90,
          average_speed: 8.3,
          training_load: 12.5,
          zone: 4,
        },
        {
          id: 2,
          type: "RECOVERY",
          elapsed_time: 120,
        },
      ],
    });
    const out = (await icuGetActivityIntervals.execute(
      { activityId: "i1" },
      ctx(conn)
    )) as {
      activityId: string;
      intervals: Array<Record<string, unknown>>;
      summary: {
        totalIntervals: number;
        workIntervals: number;
        recoveryIntervals: number;
        totalWorkDurationS: number;
      };
    };

    expect(spy).toHaveBeenCalledWith(conn, "/activity/i1/intervals");
    expect(out.intervals).toHaveLength(2);
    expect(out.intervals[0]).toMatchObject({
      id: 1,
      type: "WORK",
      durationS: 600,
      distanceM: 5000,
      avgWatts: 280,
      normalizedWatts: 285,
      avgHr: 160,
      maxHr: 175,
      trainingLoad: 12.5,
      zone: 4,
    });
    expect(out.summary).toEqual({
      totalIntervals: 2,
      workIntervals: 1,
      recoveryIntervals: 1,
      totalWorkDurationS: 600,
    });
    vi.restoreAllMocks();
  });

  it("handles a response with no intervals", async () => {
    const conn = {
      status: "active",
      encryptedAccessToken: "x",
      externalAthleteId: "i1",
    };
    const mod = await import("@/lib/connectors/intervals");
    vi.spyOn(mod, "icuRequest").mockResolvedValue({
      id: "a1",
      icu_intervals: [],
    });
    const out = (await icuGetActivityIntervals.execute(
      { activityId: "i1" },
      ctx(conn)
    )) as { intervals: unknown[]; summary: { totalIntervals: number } };
    expect(out.intervals).toEqual([]);
    expect(out.summary.totalIntervals).toBe(0);
    vi.restoreAllMocks();
  });
});
