import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { exportUserData } from "@/lib/export/export-user";

export const dynamic = "force-dynamic";

/**
 * Full personal-data export (JSON download) — the athlete owns their data.
 * See `exportUserData` for the complete table-by-table inclusion list and
 * the reasoning behind what's excluded.
 */
export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return new Response("Unauthorized", { status: 401 });

  const data = await exportUserData(db, session.user.id);
  const body = JSON.stringify(data, null, 2);

  return new Response(body, {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="recover-export-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  });
}
