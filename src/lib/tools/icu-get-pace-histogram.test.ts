import { describe, expect, it, vi } from "vitest";
import { icuGetPaceHistogram } from "./icu-get-pace-histogram";
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

describe("icu_get_pace_histogram", () => {
  it("errors without an active connection", async () => {
    const out = await icuGetPaceHistogram.execute(
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
      { min: 240, max: 269, secs: 100 },
      { min: 270, max: 299, secs: 400 },
    ]);
    const out = (await icuGetPaceHistogram.execute(
      { activityId: "i1" },
      ctx(conn)
    )) as {
      activityId: string;
      buckets: Array<{ min: number; max: number; timeS: number }>;
      totalTimeS: number;
    };

    expect(spy).toHaveBeenCalledWith(conn, "/activity/i1/pace-histogram");
    expect(out.buckets[0]).toEqual({ min: 240, max: 269, timeS: 100 });
    expect(out.buckets[1]).toEqual({ min: 270, max: 299, timeS: 400 });
    expect(out.totalTimeS).toBe(500);
    vi.restoreAllMocks();
  });
});
