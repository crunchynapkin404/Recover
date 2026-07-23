import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getLastSyncAt } from "@/lib/sync/scheduler";

export const dynamic = "force-dynamic";

/** Cheap read used by the dashboard's client-side poll (sync-chip.tsx) so a
 *  background/webhook-triggered sync shows up without a manual refresh. */
export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const lastSyncAt = await getLastSyncAt(session.user.id);
  return NextResponse.json({ lastSyncAt });
}
