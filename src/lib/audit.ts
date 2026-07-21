import { db, schema } from "@/lib/db";

export type AuditEvent =
  | "login_success"
  | "login_fail"
  | "token_created"
  | "token_revoked"
  | "connection_added"
  | "connection_revoked";

/**
 * Record a security-relevant event. Never pass a secret in `metadata` — a
 * token label or provider name only. Best-effort: a logging failure must never
 * break the action it accompanies, so this swallows its own errors.
 */
export async function recordAuditEvent(input: {
  event: AuditEvent;
  userId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown> | null;
}): Promise<void> {
  try {
    await db.insert(schema.auditLog).values({
      event: input.event,
      userId: input.userId ?? null,
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
      metadata: input.metadata ?? null,
    });
  } catch (err) {
    const { logger } = await import("@/lib/logger");
    logger.error("audit event write failed", {
      event: input.event,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
