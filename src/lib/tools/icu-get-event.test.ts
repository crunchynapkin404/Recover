import { describe, expect, it, vi } from "vitest";
import { icuGetEvent } from "./icu-get-event";
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

describe("icu_get_event", () => {
  it("errors without an active connection", async () => {
    const out = await icuGetEvent.execute({ eventId: 42 }, ctx(null));
    expect(out).toEqual({ error: "No active intervals.icu connection" });
  });

  it("returns a shaped event for an active connection", async () => {
    const conn = {
      status: "active",
      encryptedAccessToken: "x",
      externalAthleteId: "i1",
    };
    const mod = await import("@/lib/connectors/intervals");
    const spy = vi.spyOn(mod, "icuRequest").mockResolvedValue({
      id: 42,
      start_date_local: "2026-01-02T00:00:00",
      category: "WORKOUT",
      name: "Z2",
      description: "Easy spin",
    });
    const out = (await icuGetEvent.execute({ eventId: 42 }, ctx(conn))) as {
      event: { id: number; name: string };
    };
    expect(out.event).toMatchObject({ id: 42, name: "Z2" });
    expect(spy).toHaveBeenCalledWith(conn, "/athlete/{id}/events/42");
    vi.restoreAllMocks();
  });
});
