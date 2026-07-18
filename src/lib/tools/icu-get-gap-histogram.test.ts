import { describe, expect, it, vi } from "vitest";
import { icuGetGapHistogram } from "./icu-get-gap-histogram";
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

describe("icu_get_gap_histogram", () => {
  it("errors without an active connection", async () => {
    const out = await icuGetGapHistogram.execute(
      { activityId: "i1" },
      ctx(null)
    );
    expect(out).toEqual({ error: "No active intervals.icu connection" });
  });

  it("returns shaped buckets with a GAP explainer note", async () => {
    const conn = {
      status: "active",
      encryptedAccessToken: "x",
      externalAthleteId: "i1",
    };
    const mod = await import("@/lib/connectors/intervals");
    const spy = vi.spyOn(mod, "icuRequest").mockResolvedValue([
      { min: 240, max: 269, secs: 200 },
      { min: 270, max: 299, secs: 300 },
    ]);
    const out = (await icuGetGapHistogram.execute(
      { activityId: "i1" },
      ctx(conn)
    )) as {
      activityId: string;
      buckets: Array<{ min: number; max: number; timeS: number }>;
      totalTimeS: number;
      note: string;
    };

    expect(spy).toHaveBeenCalledWith(conn, "/activity/i1/gap-histogram");
    expect(out.buckets[0]).toEqual({ min: 240, max: 269, timeS: 200 });
    expect(out.totalTimeS).toBe(500);
    expect(out.note).toMatch(/grade.adjusted/i);
    vi.restoreAllMocks();
  });
});
