import { z } from "zod";
import { getOpsSnapshot } from "@/lib/ops-metrics";
import type { ToolDefinition, ToolContext } from "./registry";

const parameters = z.object({});

function formatAge(ageSeconds: number): string {
  const hours = Math.max(0, Math.round(ageSeconds / 3600));
  return `${hours}h ago`;
}

async function execute(_args: z.infer<typeof parameters>, _ctx: ToolContext) {
  const snapshot = await getOpsSnapshot();
  if (snapshot.backupAgeS == null) {
    return {
      backupAgeSeconds: null,
      isStale: true,
      statusSummary: "Never backed up",
    };
  }

  const isStale = snapshot.backupAgeS >= 24 * 3600;
  return {
    backupAgeSeconds: snapshot.backupAgeS,
    isStale,
    statusSummary: `${isStale ? "Stale" : "Fresh"} (${formatAge(snapshot.backupAgeS)})`,
  };
}

export const getBackupStatus: ToolDefinition<typeof parameters> = {
  name: "get_backup_status",
  description:
    "Get the most recent backup freshness status, including age and whether the backup appears stale.",
  parameters,
  execute,
};