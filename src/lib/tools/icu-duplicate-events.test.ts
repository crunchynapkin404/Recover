import { describe, expect, it, vi } from "vitest";
import { icuDuplicateEvents } from "./icu-duplicate-events";
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

describe("icu_duplicate_events", () => {
  it("errors without an active connection", async () => {
    const out = await icuDuplicateEvents.execute(
      icuDuplicateEvents.parameters.parse({ eventIds: [1] }),
      ctx(null)
    );
    expect(out).toEqual({ error: "No active intervals.icu connection" });
  });

  // intervals.icu has a dedicated POST /duplicate-events endpoint taking
  // {eventIds, numCopies, weeksBetween} (client.py:duplicate_events / openapi
  // DuplicateEventsDTO) — there is no dayOffset field anywhere in the
  // reference, and no client-side fetch+shift+bulk-create step; the API does
  // the copying server-side.
  it("posts eventIds/numCopies/weeksBetween and returns duplicated events", async () => {
    const conn = {
      status: "active",
      encryptedAccessToken: "x",
      externalAthleteId: "i1",
    };
    const mod = await import("@/lib/connectors/intervals");
    const spy = vi.spyOn(mod, "icuRequest").mockResolvedValue([
      {
        id: 10,
        start_date_local: "2026-02-08T00:00:00",
        category: "WORKOUT",
        name: "Z2",
      },
      {
        id: 11,
        start_date_local: "2026-02-15T00:00:00",
        category: "WORKOUT",
        name: "Z2",
      },
    ]);
    const out = (await icuDuplicateEvents.execute(
      { eventIds: [1], numCopies: 2, weeksBetween: 1 },
      ctx(conn)
    )) as { events: unknown[]; duplicatedCount: number };

    expect(spy).toHaveBeenCalledWith(conn, "/athlete/{id}/duplicate-events", {
      method: "POST",
      body: { eventIds: [1], numCopies: 2, weeksBetween: 1 },
    });
    expect(out.duplicatedCount).toBe(2);
    expect(out.events).toHaveLength(2);
    vi.restoreAllMocks();
  });

  it("defaults numCopies and weeksBetween to 1 once parsed through the schema", async () => {
    // Defaults are applied by the zod schema, which both the MCP SDK and the
    // AI SDK run before invoking execute() — parse() here mirrors that path
    // rather than relying on execute() to know about defaults itself.
    const conn = {
      status: "active",
      encryptedAccessToken: "x",
      externalAthleteId: "i1",
    };
    const mod = await import("@/lib/connectors/intervals");
    const spy = vi.spyOn(mod, "icuRequest").mockResolvedValue([]);
    const parsed = icuDuplicateEvents.parameters.parse({ eventIds: [1, 2] });
    await icuDuplicateEvents.execute(parsed, ctx(conn));

    expect(spy).toHaveBeenCalledWith(conn, "/athlete/{id}/duplicate-events", {
      method: "POST",
      body: { eventIds: [1, 2], numCopies: 1, weeksBetween: 1 },
    });
    vi.restoreAllMocks();
  });
});
