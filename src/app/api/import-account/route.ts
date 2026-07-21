import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { EXPORT_VERSION, type UserExport } from "@/lib/export/export-user";
import { importUserData } from "@/lib/export/import-user";

export const dynamic = "force-dynamic";

// Generous but bounded — a real export can be large (activity_streams time
// series, years of chat history), but this is still a JSON file upload, not
// arbitrary traffic. 200 MB comfortably covers even a multi-year, heavy-use
// export while ruling out something pathological.
const MAX_BODY_BYTES = 200 * 1024 * 1024;

/** Minimal shape check — enough to reject "this obviously isn't a Recover
 * export" (wrong file, truncated upload, hand-edited JSON missing a
 * section) before spending a transaction on it. Field-level validation
 * happens implicitly: any row shaped wrong will fail its insert and roll
 * back the whole transaction (see import-user.ts). */
function looksLikeUserExport(body: unknown): body is UserExport {
  if (typeof body !== "object" || body === null) return false;
  const b = body as Record<string, unknown>;
  const arrayFields: (keyof UserExport)[] = [
    "wellness_daily",
    "activities",
    "daily_metrics",
    "chat_threads",
    "chat_messages",
    "coach_memories",
    "biomarkers",
    "body_prefs",
    "notification_prefs",
    "journal_prefs",
    "llm_settings",
    "races",
    "training_plans",
    "training_blocks",
    "week_plans",
    "plan_adjustments",
    "activity_streams",
    "api_tokens",
    "connections",
    "webhook_subscriptions",
    "llm_usage",
  ];
  return (
    typeof b.version === "number" &&
    arrayFields.every((f) => Array.isArray(b[f]))
  );
}

/**
 * Restore a previously-exported account (see `/api/export`) into the
 * caller's own account. Session-gated; always imports into
 * `session.user.id` — there is no request field for a target user, so a
 * caller can never import into anyone else's account.
 *
 * Intended use: restoring your own data into a fresh or freshly-wiped
 * account (new install, migrated host, post-erasure undo within your own
 * retention window) — not merging a backup into an already-populated
 * account. See import-user.ts's header comment for exactly why (the
 * four one-row-per-user preference tables are userId-unique; importing
 * into an account that already has rows there fails the whole import
 * atomically rather than overwriting silently).
 */
export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: "Export file too large" },
      { status: 413 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Request body is not valid JSON" },
      { status: 400 }
    );
  }

  if (!looksLikeUserExport(body)) {
    return NextResponse.json(
      { error: "This doesn't look like a Recover export file" },
      { status: 400 }
    );
  }

  if (body.version !== EXPORT_VERSION) {
    return NextResponse.json(
      {
        error: `Unsupported export version ${body.version} (this server supports version ${EXPORT_VERSION})`,
      },
      { status: 400 }
    );
  }

  try {
    await importUserData(db, session.user.id, body);
  } catch (err) {
    // Most likely failure: the account already has rows in a
    // userId-unique table (body_prefs/notification_prefs/journal_prefs/
    // llm_settings) — the transaction rolled back atomically, so nothing
    // was partially applied. Surface the underlying message: this app is
    // single-operator/self-hosted, not a multi-tenant SaaS, so the extra
    // detail helps the person debug their own import rather than posing a
    // meaningful information-disclosure risk.
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Import failed, nothing was changed: ${message}` },
      { status: 409 }
    );
  }

  const counts = {
    wellness_daily: body.wellness_daily.length,
    activities: body.activities.length,
    daily_metrics: body.daily_metrics.length,
    chat_threads: body.chat_threads.length,
    chat_messages: body.chat_messages.length,
    coach_memories: body.coach_memories.length,
    biomarkers: body.biomarkers.length,
    races: body.races.length,
    training_plans: body.training_plans.length,
    activity_streams: body.activity_streams.length,
    llm_usage: body.llm_usage.length,
    skipped_connections: body.connections.length,
    skipped_api_tokens: body.api_tokens.length,
    skipped_webhook_subscriptions: body.webhook_subscriptions.length,
  };

  return NextResponse.json({ ok: true, imported: counts });
}
