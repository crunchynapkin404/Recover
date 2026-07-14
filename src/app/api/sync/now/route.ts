import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { checkRateLimit } from "@/lib/mcp/rate-limit";
import { requestImmediateSync, runSchedulerTick } from "@/lib/sync/scheduler";

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

  const conns = await db.query.connections.findMany({
    where: eq(schema.connections.userId, session.user.id),
    columns: { lastSyncAt: true },
  });
  const last = conns
    .map((c) => c.lastSyncAt)
    .filter((d): d is Date => d != null)
    .sort((a, b) => b.getTime() - a.getTime())[0];
  return NextResponse.json({ lastSyncAt: last?.toISOString() ?? null });
}
