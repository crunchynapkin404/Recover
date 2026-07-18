import { describe, expect, it, vi } from "vitest";
import { icuGetHrHistogram } from "./icu-get-hr-histogram";
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

describe("icu_get_hr_histogram", () => {
  it("errors without an active connection", async () => {
    const out = await icuGetHrHistogram.execute(
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
    // Bare array of {min,max,secs} — the shape actually observed against the
    // live API, not openapi-spec.json's richer (unused) Bucket schema.
    const spy = vi.spyOn(mod, "icuRequest").mockResolvedValue([
      { min: 130, max: 134, secs: 2 },
      { min: 135, max: 139, secs: 49 },
      { min: 140, max: 144, secs: 210 },
    ]);
    const out = (await icuGetHrHistogram.execute(
      { activityId: "i1" },
      ctx(conn)
    )) as {
      activityId: string;
      buckets: Array<{ minBpm: number; maxBpm: number; timeS: number }>;
      totalTimeS: number;
    };

    expect(spy).toHaveBeenCalledWith(conn, "/activity/i1/hr-histogram");
    expect(out.activityId).toBe("i1");
    expect(out.buckets).toHaveLength(3);
    expect(out.buckets[0]).toEqual({ minBpm: 130, maxBpm: 134, timeS: 2 });
    expect(out.buckets[2]).toEqual({ minBpm: 140, maxBpm: 144, timeS: 210 });
    expect(out.totalTimeS).toBe(2 + 49 + 210);
    vi.restoreAllMocks();
  });

  it("handles an empty histogram", async () => {
    const conn = {
      status: "active",
      encryptedAccessToken: "x",
      externalAthleteId: "i1",
    };
    const mod = await import("@/lib/connectors/intervals");
    vi.spyOn(mod, "icuRequest").mockResolvedValue([]);
    const out = (await icuGetHrHistogram.execute(
      { activityId: "i1" },
      ctx(conn)
    )) as { buckets: unknown[]; totalTimeS: number };
    expect(out.buckets).toEqual([]);
    expect(out.totalTimeS).toBe(0);
    vi.restoreAllMocks();
  });
});
