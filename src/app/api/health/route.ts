import { NextResponse } from "next/server";
import { getOpsSnapshot } from "@/lib/ops-metrics";

export const dynamic = "force-dynamic";

/**
 * Liveness/staleness probe. 200 when the database answers; includes the age
 * of the most recent successful sync so external monitors can alert on a
 * dead scheduler (P2) without authenticating. v0.20 adds jobsPending/
 * jobsFailed/backupAgeS alongside the original fields — existing callers
 * that only read status/db/lastSyncAgeS are unaffected.
 */
export async function GET() {
  try {
    const snap = await getOpsSnapshot();

    return NextResponse.json({
      status: "ok",
      db: "up",
      lastSyncAgeS: snap.lastSyncAgeS,
      jobsPending: snap.jobsPending,
      jobsFailed: snap.jobsFailed,
      backupAgeS: snap.backupAgeS,
    });
  } catch {
    return NextResponse.json(
      { status: "degraded", db: "down" },
      { status: 503 }
    );
  }
}
