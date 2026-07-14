import { NextResponse } from "next/server";
import {
  ensureJobsForConnections,
  runSchedulerTick,
} from "@/lib/sync/scheduler";

export const dynamic = "force-dynamic";

/**
 * External-cron entry point (Vercel Cron, cron-job.org, …) — the serverless
 * alternative to the in-process interval. Guarded by CRON_SECRET.
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  await ensureJobsForConnections();
  const result = await runSchedulerTick();
  return NextResponse.json(result);
}
