import { db, schema } from "@/lib/db";

export type AuditEvent =
  | "login_success"
  | "login_fail"
  | "token_created"
  | "token_revoked"
  | "connection_added"
  | "connection_revoked"
  | "webhook_created"
  | "webhook_revoked"
  | "session_revoked"
  | "session_revoked_others"
  | "push_sent";

/**
 * Kinds that are operational rather than security-relevant. They share this
 * table because they need the same thing — a durable, queryable record that
 * outlives the container — but they are deliberately kept out of the owner's
 * security view, which shows only the 50 most recent rows and would otherwise
 * show nothing but pushes within a day.
 */
type OperationalEvent = "push_sent";

type SecurityEvent = Exclude<AuditEvent, OperationalEvent>;

/**
 * A witness, not a list: `Record<SecurityEvent, true>` requires every key, so
 * adding a kind to `AuditEvent` without classifying it here is a compile
 * error. A hand-maintained array would silently omit the new kind from the
 * security view instead — the quiet-omission failure this codebase keeps
 * finding in hand-maintained lists.
 */
const SECURITY_EVENT_WITNESS: Record<SecurityEvent, true> = {
  login_success: true,
  login_fail: true,
  token_created: true,
  token_revoked: true,
  connection_added: true,
  connection_revoked: true,
  webhook_created: true,
  webhook_revoked: true,
  session_revoked: true,
  session_revoked_others: true,
};

/** The kinds the owner-facing security view shows. */
export const SECURITY_EVENTS = Object.keys(
  SECURITY_EVENT_WITNESS
) as SecurityEvent[];

/**
 * Record an audited event. Never pass a secret in `metadata` — a token label
 * or provider name only, and never a push payload's title or body. Best-effort:
 * a logging failure must never break the action it accompanies, so this
 * swallows its own errors.
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
