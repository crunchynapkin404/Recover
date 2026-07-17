import { describe, expect, it, vi } from "vitest";
import { icuAddActivityMessage } from "./icu-add-activity-message";
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

describe("icu_add_activity_message", () => {
  it("errors without an active connection", async () => {
    const out = await icuAddActivityMessage.execute(
      { activityId: "i1", content: "Felt strong today" },
      ctx(null)
    );
    expect(out).toEqual({ error: "No active intervals.icu connection" });
  });

  it("errors on empty (whitespace-only) content", async () => {
    const conn = {
      status: "active",
      encryptedAccessToken: "x",
      externalAthleteId: "i1",
    };
    const out = await icuAddActivityMessage.execute(
      { activityId: "i1", content: "   " },
      ctx(conn)
    );
    expect(out).toEqual({ error: "content must not be empty" });
  });

  it("posts content and returns the new message id", async () => {
    const conn = {
      status: "active",
      encryptedAccessToken: "x",
      externalAthleteId: "i1",
    };
    const mod = await import("@/lib/connectors/intervals");
    const spy = vi
      .spyOn(mod, "icuRequest")
      .mockResolvedValue({ id: 555, new_chat: {} });
    const out = (await icuAddActivityMessage.execute(
      { activityId: "i1", content: "Felt strong today" },
      ctx(conn)
    )) as { activityId: string; messageId: unknown };

    expect(spy).toHaveBeenCalledWith(conn, "/activity/i1/messages", {
      method: "POST",
      body: { content: "Felt strong today" },
    });
    expect(out).toEqual({ activityId: "i1", messageId: 555 });
    vi.restoreAllMocks();
  });
});
