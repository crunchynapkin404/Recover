import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import {
  ensureJobsForConnections,
  runSchedulerTick,
} from "@/lib/sync/scheduler";

export const dynamic = "force-dynamic";

/** Constant-time secret comparison (hash first so lengths always match). */
function secretsMatch(provided: string, expected: string): boolean {
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/**
 * External-cron entry point (Vercel Cron, cron-job.org, …) — the serverless
 * alternative to the in-process interval. Guarded by CRON_SECRET.
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  const provided = req.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!secret || !provided || !secretsMatch(provided, secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  await ensureJobsForConnections();
  const result = await runSchedulerTick();
  return NextResponse.json(result);
}
