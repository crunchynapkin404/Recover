import { describe, expect, it, vi } from "vitest";
import { icuSearchActivities } from "./icu-search-activities";
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

describe("icu_search_activities", () => {
  it("errors without an active connection", async () => {
    const out = await icuSearchActivities.execute(
      { q: "threshold" },
      ctx(null)
    );
    expect(out).toEqual({ error: "No active intervals.icu connection" });
  });

  it("searches with q and returns shaped light results", async () => {
    const conn = {
      status: "active",
      encryptedAccessToken: "x",
      externalAthleteId: "i1",
    };
    const mod = await import("@/lib/connectors/intervals");
    const spy = vi.spyOn(mod, "icuRequest").mockResolvedValue([
      {
        id: "a1",
        name: "Threshold Intervals",
        start_date_local: "2026-06-01T08:00:00",
        type: "Ride",
        distance: 30000,
        moving_time: 3600,
        race: false,
        tags: ["ftp-test"],
      },
    ]);
    const out = (await icuSearchActivities.execute(
      { q: "threshold" },
      ctx(conn)
    )) as {
      query: string;
      activities: unknown[];
      count: number;
    };

    expect(spy).toHaveBeenCalledWith(conn, "/athlete/{id}/activities/search", {
      query: { q: "threshold", limit: undefined },
    });
    expect(out.query).toBe("threshold");
    expect(out.count).toBe(1);
    expect(out.activities[0]).toMatchObject({
      id: "a1",
      name: "Threshold Intervals",
      date: "2026-06-01T08:00:00",
      type: "Ride",
      distanceM: 30000,
      durationS: 3600,
    });
    vi.restoreAllMocks();
  });

  it("passes limit through as a server-side query param when provided", async () => {
    const conn = {
      status: "active",
      encryptedAccessToken: "x",
      externalAthleteId: "i1",
    };
    const mod = await import("@/lib/connectors/intervals");
    const spy = vi.spyOn(mod, "icuRequest").mockResolvedValue([]);
    await icuSearchActivities.execute({ q: "#race", limit: 5 }, ctx(conn));

    expect(spy).toHaveBeenCalledWith(conn, "/athlete/{id}/activities/search", {
      query: { q: "#race", limit: 5 },
    });
    vi.restoreAllMocks();
  });

  it("rejects an empty query", () => {
    const result = icuSearchActivities.parameters.safeParse({ q: "" });
    expect(result.success).toBe(false);
  });
});
