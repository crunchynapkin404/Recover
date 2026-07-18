import { describe, expect, it, vi } from "vitest";
import { icuUpdateActivity } from "./icu-update-activity";
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

describe("icu_update_activity", () => {
  it("errors without an active connection", async () => {
    const out = await icuUpdateActivity.execute(
      { activityId: "i1", name: "New name" },
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
    const out = await icuUpdateActivity.execute(
      { activityId: "i1" },
      ctx(conn)
    );
    expect(out).toEqual({ error: "No fields provided to update." });
  });

  it("puts only the changed fields and returns the updated activity", async () => {
    const conn = {
      status: "active",
      encryptedAccessToken: "x",
      externalAthleteId: "i1",
    };
    const mod = await import("@/lib/connectors/intervals");
    const spy = vi.spyOn(mod, "icuRequest").mockResolvedValue({
      id: "i1",
      name: "New name",
      type: "Ride",
      start_date_local: "2026-02-01T00:00:00",
      feel: 4,
      perceived_exertion: 6.5,
    });
    const out = (await icuUpdateActivity.execute(
      { activityId: "i1", name: "New name", feel: 4, perceivedExertion: 6.5 },
      ctx(conn)
    )) as { activity: { name: string; feel: unknown } };

    expect(spy).toHaveBeenCalledWith(conn, "/activity/i1", {
      method: "PUT",
      body: { name: "New name", feel: 4, perceived_exertion: 6.5 },
    });
    expect(out.activity.name).toBe("New name");
    expect(out.activity.feel).toBe(4);
    vi.restoreAllMocks();
  });
});
