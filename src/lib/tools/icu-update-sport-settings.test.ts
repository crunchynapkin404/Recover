import { describe, expect, it, vi } from "vitest";
import { icuUpdateSportSettings } from "./icu-update-sport-settings";
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

describe("icu_update_sport_settings", () => {
  it("errors without an active connection", async () => {
    const out = await icuUpdateSportSettings.execute(
      icuUpdateSportSettings.parameters.parse({ sportId: "1", ftp: 260 }),
      ctx(null)
    );
    expect(out).toEqual({ error: "No active intervals.icu connection" });
  });

  it("errors when no fields are provided to update", async () => {
    const conn = {
      status: "active",
      encryptedAccessToken: "x",
      externalAthleteId: "i1",
    };
    const out = await icuUpdateSportSettings.execute(
      icuUpdateSportSettings.parameters.parse({ sportId: "1" }),
      ctx(conn)
    );
    expect(out).toEqual({ error: "No fields provided to update." });
  });

  // Field names verified against openapi-spec.json's SportSettings schema:
  // the API uses `lthr` (not `fthr`) and a single `threshold_pace` (not a
  // separate pace/swim threshold) — the standalone intervals-icu-mcp
  // server's models.py/client.py use stale names that don't appear in the
  // live schema. recalcHrZones is a required query param per openapi-spec.json
  // (PUT /athlete/{athleteId}/sport-settings/{id}), sent explicitly here
  // (default false) even though client.py's update_sport_settings omits it.
  it("puts only the changed fields, with recalcHrZones defaulted false in the query", async () => {
    const conn = {
      status: "active",
      encryptedAccessToken: "x",
      externalAthleteId: "i1",
    };
    const mod = await import("@/lib/connectors/intervals");
    const spy = vi.spyOn(mod, "icuRequest").mockResolvedValue({
      id: 1,
      types: ["Ride"],
      ftp: 260,
      lthr: 168,
    });
    const parsed = icuUpdateSportSettings.parameters.parse({
      sportId: "1",
      ftp: 260,
      fthr: 168,
    });
    const out = (await icuUpdateSportSettings.execute(parsed, ctx(conn))) as {
      sportSettings: { ftpWatts: unknown; fthrBpm: unknown };
    };

    expect(spy).toHaveBeenCalledWith(conn, "/athlete/{id}/sport-settings/1", {
      method: "PUT",
      query: { recalcHrZones: false },
      body: { ftp: 260, lthr: 168 },
    });
    expect(out.sportSettings.ftpWatts).toBe(260);
    expect(out.sportSettings.fthrBpm).toBe(168);
    vi.restoreAllMocks();
  });

  it("passes recalcHrZones=true through to the query when requested", async () => {
    const conn = {
      status: "active",
      encryptedAccessToken: "x",
      externalAthleteId: "i1",
    };
    const mod = await import("@/lib/connectors/intervals");
    const spy = vi
      .spyOn(mod, "icuRequest")
      .mockResolvedValue({ id: 1, ftp: 260 });
    const parsed = icuUpdateSportSettings.parameters.parse({
      sportId: "1",
      ftp: 260,
      recalcHrZones: true,
    });
    await icuUpdateSportSettings.execute(parsed, ctx(conn));

    expect(spy).toHaveBeenCalledWith(conn, "/athlete/{id}/sport-settings/1", {
      method: "PUT",
      query: { recalcHrZones: true },
      body: { ftp: 260 },
    });
    vi.restoreAllMocks();
  });
});
