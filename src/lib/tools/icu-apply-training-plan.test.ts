import { describe, expect, it, vi } from "vitest";
import { icuApplyTrainingPlan } from "./icu-apply-training-plan";
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

describe("icu_apply_training_plan", () => {
  it("errors without an active connection", async () => {
    const out = await icuApplyTrainingPlan.execute(
      { folderId: 42, startDate: "2026-08-01" },
      ctx(null)
    );
    expect(out).toEqual({ error: "No active intervals.icu connection" });
  });

  // Payload verified against client.py:apply_training_plan (~line 601) and
  // openapi-spec.json's ApplyPlanDTO: {folder_id, start_date_local,
  // extra_workouts?}. start_date_local is always normalized to local
  // midnight (event_management.py:apply_training_plan), unlike
  // icu_create_event/icu_update_event which only pad a bare date.
  it("posts folder_id/start_date_local (normalized to midnight)", async () => {
    const conn = {
      status: "active",
      encryptedAccessToken: "x",
      externalAthleteId: "i1",
    };
    const mod = await import("@/lib/connectors/intervals");
    const spy = vi
      .spyOn(mod, "icuRequest")
      .mockResolvedValue({ applied: true });
    const out = (await icuApplyTrainingPlan.execute(
      { folderId: 42, startDate: "2026-08-01" },
      ctx(conn)
    )) as { folderId: number; startDate: string; result: unknown };

    expect(spy).toHaveBeenCalledWith(conn, "/athlete/{id}/events/apply-plan", {
      method: "POST",
      body: { folder_id: 42, start_date_local: "2026-08-01T00:00:00" },
    });
    expect(out).toEqual({
      folderId: 42,
      startDate: "2026-08-01",
      result: { applied: true },
    });
    vi.restoreAllMocks();
  });

  it("includes extraWorkouts as extra_workouts when provided", async () => {
    const conn = {
      status: "active",
      encryptedAccessToken: "x",
      externalAthleteId: "i1",
    };
    const mod = await import("@/lib/connectors/intervals");
    const spy = vi
      .spyOn(mod, "icuRequest")
      .mockResolvedValue({ applied: true });
    await icuApplyTrainingPlan.execute(
      {
        folderId: 42,
        startDate: "2026-08-01",
        extraWorkouts: [{ name: "Extra shakeout" }],
      },
      ctx(conn)
    );

    expect(spy).toHaveBeenCalledWith(conn, "/athlete/{id}/events/apply-plan", {
      method: "POST",
      body: {
        folder_id: 42,
        start_date_local: "2026-08-01T00:00:00",
        extra_workouts: [{ name: "Extra shakeout" }],
      },
    });
    vi.restoreAllMocks();
  });
});
