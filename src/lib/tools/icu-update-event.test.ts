import { describe, expect, it, vi } from "vitest";
import { icuUpdateEvent } from "./icu-update-event";
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

describe("icu_update_event", () => {
  it("errors without an active connection", async () => {
    const out = await icuUpdateEvent.execute(
      { eventId: 42, name: "New name" },
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
    const out = await icuUpdateEvent.execute({ eventId: 42 }, ctx(conn));
    expect(out).toEqual({ error: "No fields provided to update." });
  });

  it("puts only the changed fields and returns the updated event", async () => {
    const conn = {
      status: "active",
      encryptedAccessToken: "x",
      externalAthleteId: "i1",
    };
    const mod = await import("@/lib/connectors/intervals");
    const spy = vi.spyOn(mod, "icuRequest").mockResolvedValue({
      id: 42,
      start_date_local: "2026-02-01T00:00:00",
      category: "WORKOUT",
      name: "New name",
    });
    const out = (await icuUpdateEvent.execute(
      { eventId: 42, name: "New name" },
      ctx(conn)
    )) as { event: { name: string } };

    expect(spy).toHaveBeenCalledWith(conn, "/athlete/{id}/events/42", {
      method: "PUT",
      body: { name: "New name" },
    });
    expect(out.event.name).toBe("New name");
    vi.restoreAllMocks();
  });
});
