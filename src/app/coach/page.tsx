import { redirect } from "next/navigation";
import { and, eq, desc } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { AppShell, shellUser } from "@/components/app-shell";
import { ChatInterface } from "@/components/coach/chat-interface";
import { HistorySheet } from "@/components/coach/history-panel";
import { listInboxItems, markThreadRead } from "@/lib/coach-inbox";

export default async function CoachPage({
  searchParams,
}: {
  searchParams: Promise<{ thread?: string; tab?: string; history?: string }>;
}) {
  const user = await requireUser();
  const { thread: initialThreadId, tab, history } = await searchParams;

  // The merged History panel covers what the old Inbox tab did.
  if (tab === "inbox") redirect("/coach");

  // Opening a coach thread is what marks its items read — the athlete has
  // the whole conversation in front of them at that point.
  if (initialThreadId) await markThreadRead(user.id, initialThreadId);

  const llmSettings = await db.query.llmSettings.findFirst({
    where: eq(schema.llmSettings.userId, user.id),
  });

  const [threadRows, inboxItems] = await Promise.all([
    db.query.chatThreads.findMany({
      where: and(
        eq(schema.chatThreads.userId, user.id),
        eq(schema.chatThreads.kind, "chat")
      ),
      orderBy: desc(schema.chatThreads.updatedAt),
      limit: 20,
    }),
    listInboxItems(user.id),
  ]);

  const threads = threadRows.map((t) => ({
    id: t.id,
    title: t.title ?? "New chat",
    updatedAt: t.updatedAt.toISOString(),
    ephemeral: t.ephemeral,
  }));
  const unread = inboxItems.filter((i) => i.unread).length;

  return (
    <AppShell
      noChrome
      user={shellUser(user)}
      overlay={
        history === "1" ? (
          // Mobile only — desktop reads History from the header dropdown,
          // which lives inline in ChatInterface rather than this overlay.
          <div className="lg:hidden">
            <HistorySheet
              inboxItems={inboxItems}
              threads={threads}
              activeThreadId={initialThreadId ?? null}
              unread={unread}
              closeHref={
                initialThreadId ? `/coach?thread=${initialThreadId}` : "/coach"
              }
            />
          </div>
        ) : null
      }
    >
      <ChatInterface
        key={initialThreadId ?? "new"}
        configured={!!llmSettings}
        defaultMode={llmSettings?.defaultMode ?? "deep"}
        initialThreadId={initialThreadId ?? null}
        threads={threads}
        inboxItems={inboxItems}
        unread={unread}
      />
    </AppShell>
  );
}
