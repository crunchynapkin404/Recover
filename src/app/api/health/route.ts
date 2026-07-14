import { NextResponse } from "next/server";
import { desc, isNotNull } from "drizzle-orm";
import { db, schema } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Liveness/staleness probe. 200 when the database answers; includes the age
 * of the most recent successful sync so external monitors can alert on a
 * dead scheduler (P2) without authenticating.
 */
export async function GET() {
  try {
    const latest = await db.query.connections.findFirst({
      where: isNotNull(schema.connections.lastSyncAt),
      orderBy: desc(schema.connections.lastSyncAt),
      columns: { lastSyncAt: true },
    });

    const lastSyncAgeS = latest?.lastSyncAt
      ? Math.round((Date.now() - latest.lastSyncAt.getTime()) / 1000)
      : null;

    return NextResponse.json({ status: "ok", db: "up", lastSyncAgeS });
  } catch {
    return NextResponse.json(
      { status: "degraded", db: "down" },
      { status: 503 }
    );
  }
}
