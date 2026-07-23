import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";

/**
 * The coach's outbox, read as the athlete's inbox (1f).
 *
 * Everything the coach writes unprompted already lives in a system thread:
 * the morning brief, the weekly review, a ride debrief, the monthly report.
 * The inbox is a view over those messages — no new tables, no duplicated
 * copy. Overtraining warnings aren't a separate thread either; a morning
 * message carries the warning kind in its toolCalls, so it's typed from
 * that rather than invented as its own record.
 */

export type InboxKind =
  "morning" | "weekly" | "debrief" | "monthly" | "warning";

/** Thread kinds the inbox reads. 'chat' is the athlete's own conversation. */
export const INBOX_THREAD_KINDS = [
  "morning",
  "weekly",
  "debrief",
  "monthly",
] as const;

export interface InboxItem {
  id: string;
  threadId: string;
  kind: InboxKind;
  title: string;
  /** Full message text; the UI clamps it to two lines. */
  preview: string;
  createdAt: Date;
  unread: boolean;
}

const KIND_TITLE: Record<Exclude<InboxKind, "warning" | "debrief">, string> = {
  morning: "Morning brief",
  weekly: "Weekly review",
  monthly: "Monthly report",
};

/** A debrief thread is titled for its activity; fall back to the kind. */
function titleFor(
  kind: InboxKind,
  threadTitle: string | null,
  warning: string | null
): string {
  if (kind === "warning") {
    return `Overtraining watch${warning ? ` — ${warning.replace(/_/g, " ")}` : ""}`;
  }
  if (kind === "debrief") {
    if (!threadTitle) return "Ride debrief";
    // generateRideReview already titles its thread "Ride debrief — <name>",
    // so prefixing again would print it twice.
    return /^ride debrief/i.test(threadTitle)
      ? threadTitle
      : `Ride debrief — ${threadTitle}`;
  }
  return KIND_TITLE[kind];
}

/**
 * The coach writes markdown. A two-line preview has no room to render it,
 * and raw "**" reads as noise, so the markers come off — the text itself is
 * untouched, and the full message keeps its formatting in the thread.
 */
export function previewText(content: string): string {
  return content
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/(\*\*\*|\*\*|__)(.*?)\1/g, "$2")
    .replace(/(^|\s)[*_]([^*_\n]+)[*_](?=\s|$|[.,;:!?])/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Newest first. Only assistant messages count — a system thread also holds
 * the athlete's own replies once they answer one, and those aren't mail.
 */
export async function listInboxItems(
  userId: string,
  limit = 40
): Promise<InboxItem[]> {
  const threads = await db.query.chatThreads.findMany({
    where: and(
      eq(schema.chatThreads.userId, userId),
      inArray(schema.chatThreads.kind, [...INBOX_THREAD_KINDS])
    ),
  });
  if (threads.length === 0) return [];

  const byId = new Map(threads.map((t) => [t.id, t]));
  const messages = await db.query.chatMessages.findMany({
    where: and(
      inArray(
        schema.chatMessages.threadId,
        threads.map((t) => t.id)
      ),
      eq(schema.chatMessages.role, "assistant")
    ),
    orderBy: desc(schema.chatMessages.createdAt),
    limit,
  });

  return messages.map((m) => {
    const thread = byId.get(m.threadId)!;
    const meta = (m.toolCalls ?? {}) as { warning?: string | null };
    const warning = meta.warning ?? null;
    const kind: InboxKind =
      thread.kind === "morning" && warning
        ? "warning"
        : (thread.kind as InboxKind);
    return {
      id: m.id,
      threadId: m.threadId,
      kind,
      title: titleFor(kind, thread.title, warning),
      preview: previewText(m.content),
      createdAt: m.createdAt,
      unread: m.readAt == null,
    };
  });
}

/** Unread badge for the Inbox segment. */
export async function unreadInboxCount(userId: string): Promise<number> {
  const threads = await db.query.chatThreads.findMany({
    where: and(
      eq(schema.chatThreads.userId, userId),
      inArray(schema.chatThreads.kind, [...INBOX_THREAD_KINDS])
    ),
    columns: { id: true },
  });
  if (threads.length === 0) return 0;

  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.chatMessages)
    .where(
      and(
        inArray(
          schema.chatMessages.threadId,
          threads.map((t) => t.id)
        ),
        eq(schema.chatMessages.role, "assistant"),
        isNull(schema.chatMessages.readAt)
      )
    );
  return row?.n ?? 0;
}

/**
 * Marks every unread coach message in one thread as read — opening a thread
 * shows the whole conversation, so marking only the tapped message would
 * leave dots on items the athlete just looked at.
 *
 * Scoped by userId: a thread id from another account marks nothing.
 */
export async function markThreadRead(
  userId: string,
  threadId: string
): Promise<void> {
  const thread = await db.query.chatThreads.findFirst({
    where: and(
      eq(schema.chatThreads.id, threadId),
      eq(schema.chatThreads.userId, userId)
    ),
    columns: { id: true },
  });
  if (!thread) return;

  await db
    .update(schema.chatMessages)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(schema.chatMessages.threadId, thread.id),
        eq(schema.chatMessages.role, "assistant"),
        isNull(schema.chatMessages.readAt)
      )
    );
}
