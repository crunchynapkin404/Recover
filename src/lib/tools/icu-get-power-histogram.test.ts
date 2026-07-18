import { describe, expect, it, vi } from "vitest";
import { icuGetPowerHistogram } from "./icu-get-power-histogram";
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

describe("icu_get_power_histogram", () => {
  it("errors without an active connection", async () => {
    const out = await icuGetPowerHistogram.execute(
      { activityId: "i1" },
      ctx(null)
    );
    expect(out).toEqual({ error: "No active intervals.icu connection" });
  });

  it("returns shaped buckets for an active connection", async () => {
    const conn = {
      status: "active",
      encryptedAccessToken: "x",
      externalAthleteId: "i1",
    };
    const mod = await import("@/lib/connectors/intervals");
    const spy = vi.spyOn(mod, "icuRequest").mockResolvedValue([
      { min: 0, max: 24, secs: 66 },
      { min: 25, max: 49, secs: 300 },
      { min: 50, max: 74, secs: 90 },
    ]);
    const out = (await icuGetPowerHistogram.execute(
      { activityId: "i1" },
      ctx(conn)
    )) as {
      activityId: string;
      buckets: Array<{ minWatts: number; maxWatts: number; timeS: number }>;
      totalTimeS: number;
    };

    expect(spy).toHaveBeenCalledWith(conn, "/activity/i1/power-histogram");
    expect(out.buckets).toHaveLength(3);
    expect(out.buckets[0]).toEqual({ minWatts: 0, maxWatts: 24, timeS: 66 });
    expect(out.buckets[1]).toEqual({ minWatts: 25, maxWatts: 49, timeS: 300 });
    expect(out.totalTimeS).toBe(66 + 300 + 90);
    vi.restoreAllMocks();
  });
});
