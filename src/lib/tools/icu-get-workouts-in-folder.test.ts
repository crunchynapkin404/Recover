import { describe, expect, it, vi } from "vitest";
import { icuGetWorkoutsInFolder } from "./icu-get-workouts-in-folder";
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

describe("icu_get_workouts_in_folder", () => {
  it("errors without an active connection", async () => {
    const out = await icuGetWorkoutsInFolder.execute(
      { folderId: 1 },
      ctx(null)
    );
    expect(out).toEqual({ error: "No active intervals.icu connection" });
  });

  it("returns shaped workouts with a totals summary", async () => {
    const conn = {
      status: "active",
      encryptedAccessToken: "x",
      externalAthleteId: "i1",
    };
    const mod = await import("@/lib/connectors/intervals");
    const spy = vi.spyOn(mod, "icuRequest").mockResolvedValue([
      {
        id: 100,
        name: "Threshold Intervals",
        description: "5x5min @ FTP",
        type: "Ride",
        day: 2,
        moving_time: 3600,
        distance: 30000,
        icu_training_load: 100,
        icu_intensity: 0.9,
        joules: 800000,
        joules_above_ftp: 150000,
        indoor: true,
        color: "#ff0000",
      },
      {
        id: 101,
        name: "Easy Spin",
        moving_time: 1800,
        indoor: false,
      },
    ]);
    const out = (await icuGetWorkoutsInFolder.execute(
      { folderId: 1 },
      ctx(conn)
    )) as {
      folderId: number;
      workouts: Array<Record<string, unknown>>;
      summary: {
        totalWorkouts: number;
        totalDurationS: number;
        totalTrainingLoad: number;
        indoorWorkouts: number;
      };
    };

    expect(spy).toHaveBeenCalledWith(conn, "/athlete/{id}/folders/1/workouts");
    expect(out.folderId).toBe(1);
    expect(out.workouts[0]).toMatchObject({
      id: 100,
      name: "Threshold Intervals",
      day: 2,
      indoor: true,
      color: "#ff0000",
      metrics: {
        durationS: 3600,
        distanceM: 30000,
        trainingLoad: 100,
        intensityFactor: 0.9,
        joules: 800000,
        joulesAboveFtp: 150000,
      },
    });
    expect(out.summary).toEqual({
      totalWorkouts: 2,
      totalDurationS: 5400,
      totalTrainingLoad: 100,
      indoorWorkouts: 1,
    });
    vi.restoreAllMocks();
  });

  it("handles an empty folder", async () => {
    const conn = {
      status: "active",
      encryptedAccessToken: "x",
      externalAthleteId: "i1",
    };
    const mod = await import("@/lib/connectors/intervals");
    vi.spyOn(mod, "icuRequest").mockResolvedValue([]);
    const out = (await icuGetWorkoutsInFolder.execute(
      { folderId: 99 },
      ctx(conn)
    )) as { workouts: unknown[]; summary: { totalWorkouts: number } };
    expect(out.workouts).toEqual([]);
    expect(out.summary.totalWorkouts).toBe(0);
    vi.restoreAllMocks();
  });
});
