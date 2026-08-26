import Link from "next/link";
import { redirect } from "next/navigation";
import { and, eq, desc } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { recordSurfaceView } from "@/lib/telemetry";
import { isFirstRun } from "@/lib/first-run";
import { AppShell, shellUser } from "@/components/app-shell";
import { ChatInterface } from "@/components/coach/chat-interface";
import { HistorySheet } from "@/components/coach/history-panel";
import { Unavailable } from "@/components/ui/unavailable";
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

  await recordSurfaceView(user.id, "coach");

  // Opening a coach thread is what marks its items read — the athlete has
  // the whole conversation in front of them at that point.
  if (initialThreadId) await markThreadRead(user.id, initialThreadId);

  // A first-run athlete has no thread to open and nothing for the coach to
  // reason about yet — send them back to the data paths instead of the
  // chat surface. This is independent of chat-interface.tsx's own
  // "needs an LLM key" branch (line 327), which is the right message for an
  // established athlete who simply hasn't configured a key.
  const firstRun: boolean = await isFirstRun(user.id);

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
      {firstRun ? (
        <div
          data-testid="first-run"
          className="flex min-h-[60svh] items-center justify-center px-6"
        >
          <div className="mx-auto max-w-sm space-y-4 text-center">
            <Unavailable
              full
              state={{
                kind: "missing_input",
                needs:
                  "some training data before the coach has anything to talk about",
                fix: {
                  label: "Connect a device or log manually",
                  href: "/",
                },
              }}
            />
            {/* Unavailable's `full` treatment renders the EmptyState message
                only — it does not surface `state.fix` (see
                components/ui/unavailable.tsx). The fix link is rendered
                here instead. */}
            <Link
              href="/"
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-accent px-6 py-3 font-bold text-accent-foreground transition-all hover:bg-accent/90"
            >
              Connect a device or log manually
            </Link>
          </div>
        </div>
      ) : (
        <ChatInterface
          key={initialThreadId ?? "new"}
          configured={!!llmSettings}
          defaultMode={llmSettings?.defaultMode ?? "deep"}
          initialThreadId={initialThreadId ?? null}
          threads={threads}
          inboxItems={inboxItems}
          unread={unread}
          language={llmSettings?.coachLanguage ?? "auto"}
        />
      )}
    </AppShell>
  );
}
