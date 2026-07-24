import { describe, expect, it, vi } from "vitest";
import { getActivity } from "./get-activity";
import type { ToolContext } from "./registry";

function ctx(activity: unknown): ToolContext {
  return {
    userId: "u1",
    db: {
      query: {
        activities: { findFirst: vi.fn(async () => activity) },
      },
    } as unknown as ToolContext["db"],
  };
}

describe("get_activity", () => {
  it("returns found: false when no activity matches", async () => {
    const out = await getActivity.execute(
      { id: "11111111-1111-1111-1111-111111111111" },
      ctx(undefined)
    );
    expect(out).toEqual({ found: false });
  });

  it("reports startDateLocal, not the true-UTC startDate, when both are present", async () => {
    // A ride that's really 16:50:01 UTC, but 18:50:01 local (UTC+2) —
    // the same discrepancy list_activities already handles correctly.
    const activity = {
      id: "11111111-1111-1111-1111-111111111111",
      startDate: new Date("2026-07-20T16:50:01Z"),
      startDateLocal: new Date("2026-07-20T18:50:01Z"),
      sport: "Ride",
      name: "Evening ride",
      durationS: 3600,
      distanceM: 30000,
      load: 80,
      avgHr: 140,
      avgPower: 200,
      elevationM: 300,
    };
    const out = (await getActivity.execute(
      { id: activity.id },
      ctx(activity)
    )) as { date: string };

    expect(out.date).toBe("2026-07-20T18:50:01.000Z");
    expect(out.date).not.toBe(activity.startDate.toISOString());
  });

  it("falls back to startDate when startDateLocal is absent", async () => {
    const activity = {
      id: "11111111-1111-1111-1111-111111111111",
      startDate: new Date("2026-07-20T16:50:01Z"),
      startDateLocal: null,
      sport: "Ride",
      name: "Evening ride",
      durationS: 3600,
      distanceM: 30000,
      load: 80,
      avgHr: 140,
      avgPower: 200,
      elevationM: 300,
    };
    const out = (await getActivity.execute(
      { id: activity.id },
      ctx(activity)
    )) as { date: string };

    expect(out.date).toBe("2026-07-20T16:50:01.000Z");
  });
});
