import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkRateLimit } from "@/lib/mcp/rate-limit";
import {
  getLastSyncAt,
  requestImmediateSync,
  runSchedulerTick,
} from "@/lib/sync/scheduler";

export async function POST() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const limit = checkRateLimit(`sync-now:${session.user.id}`, 1, 120_000);
  if (!limit.allowed)
    return NextResponse.json(
      { error: "Give it a minute — sync was just requested." },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(limit.resetMs / 1000)) },
      }
    );

  await requestImmediateSync(session.user.id);
  await runSchedulerTick();

  const lastSyncAt = await getLastSyncAt(session.user.id);
  return NextResponse.json({ lastSyncAt });
}
