import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getOpsSnapshot } from "@/lib/ops-metrics";

export const dynamic = "force-dynamic";

/** Constant-time secret comparison (hash first so lengths always match). */
function secretsMatch(provided: string, expected: string): boolean {
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

interface Metric {
  name: string;
  help: string;
  type: "gauge" | "counter";
  /** null = no data yet; the metric's HELP/TYPE lines are still emitted but the sample line is omitted, per Prometheus convention of an absent series over a fabricated 0. */
  value: number | null;
}

function renderPrometheus(metrics: Metric[]): string {
  const lines: string[] = [];
  for (const m of metrics) {
    lines.push(`# HELP ${m.name} ${m.help}`);
    lines.push(`# TYPE ${m.name} ${m.type}`);
    if (m.value !== null) lines.push(`${m.name} ${m.value}`);
  }
  return lines.join("\n") + "\n";
}

/**
 * Prometheus scrape endpoint (v0.20). Guarded by METRICS_TOKEN:
 * - unset entirely            -> 404 (don't reveal the endpoint exists on
 *                                instances that haven't opted into scraping)
 * - set but bearer missing/wrong -> 401
 */
export async function GET(req: Request) {
  const token = process.env.METRICS_TOKEN;
  if (!token) {
    return new NextResponse(null, { status: 404 });
  }

  const provided = req.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!provided || !secretsMatch(provided, token)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const snap = await getOpsSnapshot();

  const body = renderPrometheus([
    {
      name: "recover_sync_staleness_seconds",
      help: "Seconds since the most recent successful connector sync across all users.",
      type: "gauge",
      value: snap.lastSyncAgeS,
    },
    {
      name: "recover_sync_jobs_pending",
      help: "Sync jobs currently queued (status=pending).",
      type: "gauge",
      value: snap.jobsPending,
    },
    {
      name: "recover_sync_jobs_running",
      help: "Sync jobs currently in flight (status=running).",
      type: "gauge",
      value: snap.jobsRunning,
    },
    {
      name: "recover_sync_jobs_failed_total",
      help: "Sync jobs currently in a failed state. Point-in-time count (jobs are retried and can leave the failed state), not a monotonic Prometheus counter — reported as a gauge despite the _total suffix, which here just names 'total currently failed'.",
      type: "gauge",
      value: snap.jobsFailed,
    },
    {
      name: "recover_backup_age_seconds",
      help: "Seconds since the last successful backup rotation reported to /api/internal/backup-complete.",
      type: "gauge",
      value: snap.backupAgeS,
    },
    {
      name: "recover_push_subscriptions",
      help: "Registered web-push subscriptions. A reach proxy, not delivery health — the schema doesn't track per-delivery failures.",
      type: "gauge",
      value: snap.pushSubscriptions,
    },
  ]);

  return new NextResponse(body, {
    status: 200,
    headers: { "content-type": "text/plain; version=0.0.4; charset=utf-8" },
  });
}
