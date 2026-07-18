import { describe, expect, it, vi } from "vitest";
import { icuBulkCreateEvents } from "./icu-bulk-create-events";
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

describe("icu_bulk_create_events", () => {
  it("errors without an active connection", async () => {
    const out = await icuBulkCreateEvents.execute(
      { events: [{ date: "2026-02-01", category: "WORKOUT", name: "Z2" }] },
      ctx(null)
    );
    expect(out).toEqual({ error: "No active intervals.icu connection" });
  });

  it("posts the mapped array body and returns created events", async () => {
    const conn = {
      status: "active",
      encryptedAccessToken: "x",
      externalAthleteId: "i1",
    };
    const mod = await import("@/lib/connectors/intervals");
    const spy = vi.spyOn(mod, "icuRequest").mockResolvedValue([
      {
        id: 1,
        start_date_local: "2026-02-01T00:00:00",
        category: "WORKOUT",
        name: "Z2",
      },
      {
        id: 2,
        start_date_local: "2026-02-08T00:00:00",
        category: "WORKOUT",
        name: "Z2",
      },
    ]);
    const out = (await icuBulkCreateEvents.execute(
      {
        events: [
          { date: "2026-02-01", category: "WORKOUT", name: "Z2" },
          { date: "2026-02-08", category: "WORKOUT", name: "Z2" },
        ],
      },
      ctx(conn)
    )) as { events: unknown[]; count: number };

    expect(spy).toHaveBeenCalledWith(conn, "/athlete/{id}/events/bulk", {
      method: "POST",
      body: [
        {
          start_date_local: "2026-02-01T00:00:00",
          category: "WORKOUT",
          name: "Z2",
        },
        {
          start_date_local: "2026-02-08T00:00:00",
          category: "WORKOUT",
          name: "Z2",
        },
      ],
    });
    expect(out.count).toBe(2);
    expect(out.events).toHaveLength(2);
    vi.restoreAllMocks();
  });
});
