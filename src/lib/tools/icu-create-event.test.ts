import { describe, expect, it, vi } from "vitest";
import { icuCreateEvent } from "./icu-create-event";
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

describe("icu_create_event", () => {
  it("errors without an active connection", async () => {
    const out = await icuCreateEvent.execute(
      { date: "2026-02-01", category: "WORKOUT", name: "Z2 ride" },
      ctx(null)
    );
    expect(out).toEqual({ error: "No active intervals.icu connection" });
  });

  it("posts the mapped event body and returns the created event", async () => {
    const conn = {
      status: "active",
      encryptedAccessToken: "x",
      externalAthleteId: "i1",
    };
    const mod = await import("@/lib/connectors/intervals");
    const spy = vi.spyOn(mod, "icuRequest").mockResolvedValue({
      id: 99,
      start_date_local: "2026-02-01T00:00:00",
      category: "WORKOUT",
      name: "Z2 ride",
    });
    const out = (await icuCreateEvent.execute(
      {
        date: "2026-02-01",
        category: "WORKOUT",
        name: "Z2 ride",
        description: "Easy spin",
        durationSeconds: 3600,
      },
      ctx(conn)
    )) as { event: { id: number } };

    expect(spy).toHaveBeenCalledWith(conn, "/athlete/{id}/events", {
      method: "POST",
      body: {
        start_date_local: "2026-02-01T00:00:00",
        category: "WORKOUT",
        name: "Z2 ride",
        description: "Easy spin",
        moving_time: 3600,
      },
    });
    expect(out.event.id).toBe(99);
    vi.restoreAllMocks();
  });
});
