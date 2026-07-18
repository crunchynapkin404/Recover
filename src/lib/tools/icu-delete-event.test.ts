import { describe, expect, it, vi } from "vitest";
import { icuDeleteEvent } from "./icu-delete-event";
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

describe("icu_delete_event", () => {
  it("errors without an active connection", async () => {
    const out = await icuDeleteEvent.execute({ eventId: 42 }, ctx(null));
    expect(out).toEqual({ error: "No active intervals.icu connection" });
  });

  it("deletes the event and returns the deleted id", async () => {
    const conn = {
      status: "active",
      encryptedAccessToken: "x",
      externalAthleteId: "i1",
    };
    const mod = await import("@/lib/connectors/intervals");
    const spy = vi.spyOn(mod, "icuRequest").mockResolvedValue(null);
    const out = await icuDeleteEvent.execute({ eventId: 42 }, ctx(conn));

    expect(spy).toHaveBeenCalledWith(conn, "/athlete/{id}/events/42", {
      method: "DELETE",
    });
    expect(out).toEqual({ deleted: 42 });
    vi.restoreAllMocks();
  });
});
