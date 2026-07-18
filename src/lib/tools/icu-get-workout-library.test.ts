import { describe, expect, it, vi } from "vitest";
import { icuGetWorkoutLibrary } from "./icu-get-workout-library";
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

describe("icu_get_workout_library", () => {
  it("errors without an active connection", async () => {
    const out = await icuGetWorkoutLibrary.execute({}, ctx(null));
    expect(out).toEqual({ error: "No active intervals.icu connection" });
  });

  it("returns shaped folders with a plan/folder summary", async () => {
    const conn = {
      status: "active",
      encryptedAccessToken: "x",
      externalAthleteId: "i1",
    };
    const mod = await import("@/lib/connectors/intervals");
    const spy = vi.spyOn(mod, "icuRequest").mockResolvedValue([
      {
        id: 1,
        type: "PLAN",
        name: "Base Plan",
        description: "12-week base",
        num_workouts: 36,
        start_date_local: "2026-06-01",
        duration_weeks: 12,
        hours_per_week_min: 8,
        hours_per_week_max: 12,
      },
      {
        id: 2,
        type: "FOLDER",
        name: "My Saved Workouts",
        num_workouts: 10,
      },
    ]);
    const out = (await icuGetWorkoutLibrary.execute({}, ctx(conn))) as {
      folders: Array<Record<string, unknown>>;
      summary: {
        totalFolders: number;
        trainingPlans: number;
        regularFolders: number;
        totalWorkouts: number;
      };
    };

    expect(spy).toHaveBeenCalledWith(conn, "/athlete/{id}/folders");
    expect(out.folders[0]).toMatchObject({
      id: 1,
      name: "Base Plan",
      durationWeeks: 12,
      hoursPerWeek: { min: 8, max: 12 },
      startDate: "2026-06-01",
    });
    expect(out.folders[1]).toMatchObject({ id: 2, name: "My Saved Workouts" });
    expect(out.folders[1]).not.toHaveProperty("durationWeeks", 12);
    expect(out.summary).toEqual({
      totalFolders: 2,
      trainingPlans: 1,
      regularFolders: 1,
      totalWorkouts: 46,
    });
    vi.restoreAllMocks();
  });
});
