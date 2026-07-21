import { and, eq, gt } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { describeUserAgent } from "@/lib/user-agent";

export interface SessionRow {
  id: string;
  device: string;
  ipAddress: string | null;
  createdAt: string;
  updatedAt: string;
  isCurrent: boolean;
}

/**
 * List the calling user's own active (non-expired) sessions, most-recently
 * active first, with the current device pinned to the top.
 *
 * Deliberately reads the `sessions` table directly — scoped to `userId`,
 * exactly like every other per-user query on the settings page (apiTokens,
 * webhookSubscriptions, connections, ...) — rather than calling Better
 * Auth's `/list-sessions` endpoint (`auth.api.listSessions`).
 *
 * Why not `auth.api.listSessions`: verified against the installed
 * better-auth 1.6.23 source
 * (node_modules/better-auth/dist/api/routes/session.mjs) that endpoint is
 * gated by `freshSessionMiddleware`, which throws a
 * FORBIDDEN/SESSION_NOT_FRESH error whenever the CALLING session's
 * `createdAt` is older than `session.freshAge` (default 24h — unconfigured
 * in src/lib/auth.ts, so the default applies). That means any user who
 * signed in more than a day ago — the common case — would see this card
 * break on every page load, before they've done anything "sensitive".
 * Reading the table directly avoids that gate while remaining fully
 * self-scoped (still Better Auth's own rows, managed entirely by Better
 * Auth via the drizzle adapter — we only ever read, never write, from this
 * module). Mutations (revoke / revoke-other) go through the real Better
 * Auth API — see src/app/settings/session-actions.ts, whose sensitive
 * endpoints are NOT gated by freshness (see that file for the citation).
 */
export async function getMySessions(
  userId: string,
  currentSessionId: string
): Promise<{ sessions: SessionRow[] }> {
  const rows = await db.query.sessions.findMany({
    where: and(
      eq(schema.sessions.userId, userId),
      gt(schema.sessions.expiresAt, new Date())
    ),
  });

  const sessions = rows
    .map((r) => ({
      id: r.id,
      device: describeUserAgent(r.userAgent),
      ipAddress: r.ipAddress ?? null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      isCurrent: r.id === currentSessionId,
    }))
    .sort((a, b) => {
      if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
      return b.updatedAt.localeCompare(a.updatedAt);
    });

  return { sessions };
}
