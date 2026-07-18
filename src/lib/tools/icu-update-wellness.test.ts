import { describe, expect, it, vi } from "vitest";
import { icuUpdateWellness } from "./icu-update-wellness";
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

describe("icu_update_wellness", () => {
  it("errors without an active connection", async () => {
    const out = await icuUpdateWellness.execute(
      { date: "2026-02-01", hrv: 55 },
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
    const out = await icuUpdateWellness.execute(
      { date: "2026-02-01" },
      ctx(conn)
    );
    expect(out).toEqual({ error: "No fields provided to update." });
  });

  it("puts only the changed fields to /athlete/{id}/wellness/{date} and returns the updated record", async () => {
    const conn = {
      status: "active",
      encryptedAccessToken: "x",
      externalAthleteId: "i1",
    };
    const mod = await import("@/lib/connectors/intervals");
    const spy = vi.spyOn(mod, "icuRequest").mockResolvedValue({
      id: "2026-02-01",
      hrv: 55,
      restingHR: 48,
      spO2: 98,
    });
    const out = (await icuUpdateWellness.execute(
      {
        date: "2026-02-01",
        hrv: 55,
        restingHr: 48,
        spo2: 98,
      },
      ctx(conn)
    )) as { wellness: { hrv: unknown; restingHr: unknown; spo2: unknown } };

    expect(spy).toHaveBeenCalledWith(
      conn,
      "/athlete/{id}/wellness/2026-02-01",
      {
        method: "PUT",
        body: { hrv: 55, restingHR: 48, spO2: 98 },
      }
    );
    expect(out.wellness.hrv).toBe(55);
    expect(out.wellness.restingHr).toBe(48);
    expect(out.wellness.spo2).toBe(98);
    vi.restoreAllMocks();
  });

  it("maps calories/hydration fields to their intervals.icu API names", async () => {
    const conn = {
      status: "active",
      encryptedAccessToken: "x",
      externalAthleteId: "i1",
    };
    const mod = await import("@/lib/connectors/intervals");
    const spy = vi.spyOn(mod, "icuRequest").mockResolvedValue({
      id: "2026-02-01",
      kcalConsumed: 2200,
      hydrationVolume: 2.5,
    });
    await icuUpdateWellness.execute(
      { date: "2026-02-01", caloriesConsumed: 2200, hydrationLiters: 2.5 },
      ctx(conn)
    );

    expect(spy).toHaveBeenCalledWith(
      conn,
      "/athlete/{id}/wellness/2026-02-01",
      {
        method: "PUT",
        body: { kcalConsumed: 2200, hydrationVolume: 2.5 },
      }
    );
    vi.restoreAllMocks();
  });
});
