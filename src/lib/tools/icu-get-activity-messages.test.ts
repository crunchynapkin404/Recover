import { describe, expect, it, vi } from "vitest";
import { icuGetActivityMessages } from "./icu-get-activity-messages";
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

describe("icu_get_activity_messages", () => {
  it("errors without an active connection", async () => {
    const out = await icuGetActivityMessages.execute(
      { activityId: "i1" },
      ctx(null)
    );
    expect(out).toEqual({ error: "No active intervals.icu connection" });
  });

  it("returns shaped messages for an active connection", async () => {
    const conn = {
      status: "active",
      encryptedAccessToken: "x",
      externalAthleteId: "i1",
    };
    const mod = await import("@/lib/connectors/intervals");
    const spy = vi.spyOn(mod, "icuRequest").mockResolvedValue([
      {
        id: 1,
        athlete_id: "i1",
        name: "Me",
        type: "TEXT",
        content: "Felt strong",
        activity_id: "i1",
        created: "2026-02-01T10:00:00Z",
        seen: true,
      },
    ]);
    const out = (await icuGetActivityMessages.execute(
      { activityId: "i1" },
      ctx(conn)
    )) as { activityId: string; messages: unknown[]; count: number };

    expect(spy).toHaveBeenCalledWith(conn, "/activity/i1/messages");
    expect(out.activityId).toBe("i1");
    expect(out.count).toBe(1);
    expect(out.messages[0]).toMatchObject({ id: 1, content: "Felt strong" });
    vi.restoreAllMocks();
  });
});
