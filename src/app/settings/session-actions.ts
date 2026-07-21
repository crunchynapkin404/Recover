"use server";

import { headers } from "next/headers";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { recordAuditEvent } from "@/lib/audit";

export interface SessionActionResult {
  ok: boolean;
  message: string;
}

/**
 * Revoke a single session belonging to the calling user.
 *
 * Self-scoping: the target row is looked up scoped to BOTH the given id AND
 * the caller's own userId (`requireSession()`) before anything else runs —
 * a foreign id, or someone else's session id, is indistinguishable from
 * "not found" and the call never reaches Better Auth.
 *
 * This is deliberately stricter than relying solely on Better Auth's own
 * guard. Verified against the installed better-auth 1.6.23 source
 * (node_modules/better-auth/dist/api/routes/session.mjs, `/revoke-session`
 * handler): it DOES check
 * `(await ctx.context.internalAdapter.findSession(token))?.session.userId
 * === ctx.context.session.user.id` before deleting — so it can never delete
 * another user's session — but on a mismatch it silently skips the delete
 * and still returns `{ status: true }` rather than an error. That's not a
 * signal a caller (or a test) can act on, so we do our own ownership check
 * first and turn a foreign token into a real, testable "not found".
 *
 * The current session is excluded here (revoking the session you're using
 * to view this page is a lockout, not a feature) — use
 * `signOutOtherSessions` instead.
 */
export async function revokeSession(
  sessionId: string
): Promise<SessionActionResult> {
  const { user, session: current } = await requireSession();

  const row = await db.query.sessions.findFirst({
    where: and(
      eq(schema.sessions.id, sessionId),
      eq(schema.sessions.userId, user.id)
    ),
  });
  if (!row) {
    return { ok: false, message: "Session not found." };
  }

  if (current.id === row.id) {
    return {
      ok: false,
      message:
        'That’s your current session — use "Sign out everywhere else" below (or Sign Out on the Profile card) instead.',
    };
  }

  await auth.api.revokeSession({
    headers: await headers(),
    body: { token: row.token },
  });

  await recordAuditEvent({
    event: "session_revoked",
    userId: user.id,
    metadata: { sessionId: row.id },
  });

  revalidatePath("/settings");
  return { ok: true, message: "Session revoked." };
}

/**
 * Sign out every OTHER active session for the calling user; the session
 * that made this request stays alive.
 *
 * Delegates entirely to Better Auth's own `/revoke-other-sessions`
 * endpoint (`auth.api.revokeOtherSessions`), which:
 *   - takes no id/token argument at all — it only ever acts on
 *     `ctx.context.session.user.id`, resolved from the request's own
 *     cookie — so there is no cross-user surface here to get wrong, and
 *   - explicitly filters out the caller's own current session token before
 *     deleting anything:
 *       `.filter((session) => session.token !== ctx.context.session.session.token)`
 *     (node_modules/better-auth/dist/api/routes/session.mjs, lines ~498-501
 *     of the installed 1.6.23 build) — i.e. the "keeps you signed in"
 *     guarantee is enforced by Better Auth itself, not by this wrapper.
 */
export async function signOutOtherSessions(): Promise<SessionActionResult> {
  const { user } = await requireSession();

  await auth.api.revokeOtherSessions({ headers: await headers() });

  await recordAuditEvent({
    event: "session_revoked_others",
    userId: user.id,
  });

  revalidatePath("/settings");
  return { ok: true, message: "Signed out of all other devices." };
}
