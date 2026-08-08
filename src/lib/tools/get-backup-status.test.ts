import { describe, expect, it, vi } from "vitest";
import { getBackupStatus } from "./get-backup-status";
import type { ToolContext } from "./registry";

function ctx(): ToolContext {
  return { userId: "u1", db: {} as unknown as ToolContext["db"] };
}

describe("get_backup_status", () => {
  it("reports a fresh backup in hours", async () => {
    const mod = await import("@/lib/ops-metrics");
    vi.spyOn(mod, "getOpsSnapshot").mockResolvedValue({
      lastSyncAgeS: null,
      jobsPending: 0,
      jobsRunning: 0,
      jobsFailed: 0,
      backupAgeS: 7200,
      pushSubscriptions: 0,
    });

    await expect(getBackupStatus.execute({}, ctx())).resolves.toEqual({
      backupAgeSeconds: 7200,
      isStale: false,
      statusSummary: "Fresh (2h ago)",
    });
    vi.restoreAllMocks();
  });

  it("marks old backups stale", async () => {
    const mod = await import("@/lib/ops-metrics");
    vi.spyOn(mod, "getOpsSnapshot").mockResolvedValue({
      lastSyncAgeS: null,
      jobsPending: 0,
      jobsRunning: 0,
      jobsFailed: 0,
      backupAgeS: 172800,
      pushSubscriptions: 0,
    });

    await expect(getBackupStatus.execute({}, ctx())).resolves.toEqual({
      backupAgeSeconds: 172800,
      isStale: true,
      statusSummary: "Stale (48h ago)",
    });
    vi.restoreAllMocks();
  });

  it("reports never backed up when no backup timestamp exists", async () => {
    const mod = await import("@/lib/ops-metrics");
    vi.spyOn(mod, "getOpsSnapshot").mockResolvedValue({
      lastSyncAgeS: null,
      jobsPending: 0,
      jobsRunning: 0,
      jobsFailed: 0,
      backupAgeS: null,
      pushSubscriptions: 0,
    });

    await expect(getBackupStatus.execute({}, ctx())).resolves.toEqual({
      backupAgeSeconds: null,
      isStale: true,
      statusSummary: "Never backed up",
    });
    vi.restoreAllMocks();
  });
});