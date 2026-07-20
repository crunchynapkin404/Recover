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
    headers: {
      "Content-Type": "application/json",
      // Token may arrive via ?token= (Health Auto Export needs a URL); keep it
      // out of referrers and caches. Header path (x-recover-token) is preferred.
      "Referrer-Policy": "no-referrer",
      "Cache-Control": "no-store",
    },
  });
}

/** Health Auto Export batches are small; anything near this is not one. */
const MAX_BODY_BYTES = 10 * 1024 * 1024;

/** Read the whole body but abort if it exceeds the cap — content-length is
 *  advisory (a client can omit or understate it). Returns null if too large. */
async function readCappedText(req: Request): Promise<string | null> {
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function POST(req: Request) {
  // Fast early-out on an honest content-length, then authoritative byte count.
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) {
    return json({ error: "Payload too large (max 10 MB)" }, 413);
  }

  const token =
    req.headers.get("x-recover-token") ??
    new URL(req.url).searchParams.get("token");
  if (!token) return json({ error: "Ingest token required" }, 401);

  const bodyText = await readCappedText(req);
  if (bodyText === null) {
    return json({ error: "Payload too large (max 10 MB)" }, 413);
  }

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
    payload = bodyText.trim() === "" ? {} : JSON.parse(bodyText);
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
