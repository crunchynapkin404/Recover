import { describe, expect, it, vi } from "vitest";
import { icuGetSportSettings } from "./icu-get-sport-settings";
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

describe("icu_get_sport_settings", () => {
  it("errors without an active connection", async () => {
    const out = await icuGetSportSettings.execute({}, ctx(null));
    expect(out).toEqual({ error: "No active intervals.icu connection" });
  });

  it("returns shaped sport settings for an active connection", async () => {
    const conn = {
      status: "active",
      encryptedAccessToken: "x",
      externalAthleteId: "i1",
    };
    const mod = await import("@/lib/connectors/intervals");
    const spy = vi.spyOn(mod, "icuRequest").mockResolvedValue([
      {
        id: 1,
        types: ["Ride", "VirtualRide"],
        ftp: 250,
        lthr: 165,
        threshold_pace: 4.5,
        pace_units: "MINS_KM",
      },
    ]);
    const out = (await icuGetSportSettings.execute({}, ctx(conn))) as {
      sportSettings: unknown[];
      count: number;
    };

    expect(spy).toHaveBeenCalledWith(conn, "/athlete/{id}/sport-settings");
    expect(out.count).toBe(1);
    expect(out.sportSettings[0]).toMatchObject({
      id: 1,
      types: ["Ride", "VirtualRide"],
      ftpWatts: 250,
      fthrBpm: 165,
      thresholdPace: 4.5,
      paceUnits: "MINS_KM",
    });
    vi.restoreAllMocks();
  });
});
