import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { BACKUP_LAST_SUCCESS_KEY } from "@/lib/ops-metrics";
import { broadcastWebhook } from "@/lib/webhooks/dispatch";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/** Constant-time secret comparison (hash first so lengths always match). */
function secretsMatch(provided: string, expected: string): boolean {
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/**
 * Internal notification hit by scripts/backup.sh right after a successful
 * pg_dump + rotation. Records an epoch-seconds timestamp in app_config so
 * /api/health and /api/metrics can report backup freshness. Guarded by
 * BACKUP_NOTIFY_SECRET (same shared-secret-header shape as /api/cron's
 * CRON_SECRET). Task 7 extends this same endpoint to also dispatch the
 * `backup_completed` webhook.
 */
export async function POST(req: Request) {
  const secret = process.env.BACKUP_NOTIFY_SECRET;
  const provided = req.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!secret || !provided || !secretsMatch(provided, secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const nowEpochS = Math.floor(Date.now() / 1000).toString();
  await db
    .insert(schema.appConfig)
    .values({ key: BACKUP_LAST_SUCCESS_KEY, value: nowEpochS })
    .onConflictDoUpdate({
      target: schema.appConfig.key,
      set: { value: nowEpochS, updatedAt: new Date() },
    });

  // v0.20 outbound webhooks — fire after the config write succeeds. Guarded:
  // a webhook failure must never turn a successful backup notification into
  // a 500 for scripts/backup.sh.
  try {
    await broadcastWebhook("backup_completed", { at: nowEpochS });
  } catch (err) {
    logger.error("backup_completed webhook dispatch failed", {
      message: err instanceof Error ? err.message : String(err),
    });
  }

  return NextResponse.json({ ok: true });
}
