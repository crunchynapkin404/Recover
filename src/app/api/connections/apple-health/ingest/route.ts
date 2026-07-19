/**
 * POST /api/connections/apple-health/ingest — Health Auto Export webhook.
 *
 * No session: the iOS app authenticates with a per-user ingest token
 * (X-Recover-Token header or ?token=), whose SHA-256 hash is stored in the
 * apple_health connection's externalAthleteId. We resolve the user by that
 * hash and merge the payload through the per-field wellness policy.
 */
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { hashToken } from "@/lib/mcp/token-auth";
import { ingestAppleHealth } from "@/lib/sync/apple-health-ingest";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Health Auto Export batches are small; anything near this is not one. */
const MAX_BODY_BYTES = 10 * 1024 * 1024;

export async function POST(req: Request) {
  const contentLength = Number(req.headers.get("content-length") ?? 0);
  if (contentLength > MAX_BODY_BYTES) {
    return json({ error: "Payload too large (max 10 MB)" }, 413);
  }

  const token =
    req.headers.get("x-recover-token") ??
    new URL(req.url).searchParams.get("token");
  if (!token) return json({ error: "Ingest token required" }, 401);

  const connection = await db.query.connections.findFirst({
    where: and(
      eq(schema.connections.provider, "apple_health"),
      eq(schema.connections.externalAthleteId, hashToken(token))
    ),
    columns: { userId: true },
  });
  if (!connection) return json({ error: "Invalid ingest token" }, 401);

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Body must be JSON" }, 400);
  }

  try {
    const result = await ingestAppleHealth(connection.userId, payload ?? {});
    logger.info("apple health ingest", {
      userId: connection.userId,
      days: result.days,
    });
    return json({ ok: true, days: result.days }, 200);
  } catch (err) {
    logger.error("apple health ingest failed", {
      userId: connection.userId,
      error: err instanceof Error ? err.message : String(err),
    });
    return json({ error: "Ingest failed" }, 500);
  }
}
