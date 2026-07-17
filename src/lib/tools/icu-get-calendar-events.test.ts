import { describe, expect, it, vi } from "vitest";
import { icuGetCalendarEvents } from "./icu-get-calendar-events";
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

describe("icu_get_calendar_events", () => {
  it("errors without an active connection", async () => {
    const out = await icuGetCalendarEvents.execute(
      { oldest: "2026-01-01", newest: "2026-01-31" },
      ctx(null)
    );
    expect(out).toEqual({ error: "No active intervals.icu connection" });
  });

  it("returns shaped events for an active connection", async () => {
    const conn = {
      status: "active",
      encryptedAccessToken: "x",
      externalAthleteId: "i1",
    };
    const mod = await import("@/lib/connectors/intervals");
    vi.spyOn(mod, "icuRequest").mockResolvedValue([
      {
        id: 1,
        start_date_local: "2026-01-02T00:00:00",
        category: "WORKOUT",
        name: "Z2",
      },
    ]);
    const out = (await icuGetCalendarEvents.execute(
      { oldest: "2026-01-01", newest: "2026-01-31" },
      ctx(conn)
    )) as { events: unknown[] };
    expect(out.events).toHaveLength(1);
    vi.restoreAllMocks();
  });
});
