import { describe, expect, it, vi } from "vitest";
import { icuBulkDeleteEvents } from "./icu-bulk-delete-events";
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

describe("icu_bulk_delete_events", () => {
  it("errors without an active connection", async () => {
    const out = await icuBulkDeleteEvents.execute(
      { eventIds: [1, 2] },
      ctx(null)
    );
    expect(out).toEqual({ error: "No active intervals.icu connection" });
  });

  // intervals.icu's bulk-delete endpoint is PUT with a body of
  // [{id: n}, ...] (per client.py:bulk_delete_events / openapi DoomedEvent),
  // not POST with {eventIds: [...]} as the brief's table suggested.
  it("PUTs [{id}] payload and returns the deleted envelope", async () => {
    const conn = {
      status: "active",
      encryptedAccessToken: "x",
      externalAthleteId: "i1",
    };
    const mod = await import("@/lib/connectors/intervals");
    const spy = vi
      .spyOn(mod, "icuRequest")
      .mockResolvedValue({ eventsDeleted: 2 });
    const out = await icuBulkDeleteEvents.execute(
      { eventIds: [1, 2] },
      ctx(conn)
    );

    expect(spy).toHaveBeenCalledWith(conn, "/athlete/{id}/events/bulk-delete", {
      method: "PUT",
      body: [{ id: 1 }, { id: 2 }],
    });
    expect(out).toEqual({ deleted: [1, 2], deletedCount: 2 });
    vi.restoreAllMocks();
  });
});
