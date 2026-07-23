import Link from "next/link";
import { eq, desc } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { AppShell } from "@/components/app-shell";
import { ChatInterface } from "@/components/coach/chat-interface";
import { InboxRail } from "@/components/coach/inbox-rail";
import {
  listInboxItems,
  markThreadRead,
  unreadInboxCount,
} from "@/lib/coach-inbox";

/** Chat | Inbox · n — links, so the segment survives a reload and a share. */
function Segments({ tab, unread }: { tab: "chat" | "inbox"; unread: number }) {
  const items = [
    { key: "chat" as const, href: "/coach", label: "Chat" },
    { key: "inbox" as const, href: "/coach?tab=inbox", label: "Inbox" },
  ];
  return (
    <nav aria-label="Coach sections" className="mt-4 flex gap-1.5">
      {items.map((i) => (
        <Link
          key={i.key}
          href={i.href}
          aria-current={i.key === tab ? "page" : undefined}
          className={`rounded-full px-4 py-1.5 text-[11px] font-bold transition-colors ${
            i.key === tab
              ? "bg-white/[0.12] text-white"
              : "bg-white/[0.04] text-white/50 hover:text-white/80"
          }`}
        >
          {i.label}
          {i.key === "inbox" && unread > 0 && (
            <span className="ml-1.5 text-emerald-400">· {unread}</span>
          )}
        </Link>
      ))}
    </nav>
  );
}

export default async function CoachPage({
  searchParams,
}: {
  searchParams: Promise<{ thread?: string; tab?: string }>;
}) {
  const user = await requireUser();
  const { thread: initialThreadId, tab } = await searchParams;

  // Opening a coach thread is what marks its items read — the athlete has
  // the whole conversation in front of them at that point.
  if (initialThreadId) await markThreadRead(user.id, initialThreadId);

  const unread = await unreadInboxCount(user.id);

  if (tab === "inbox") {
    const items = await listInboxItems(user.id);
    return (
      <AppShell>
        <header className="mb-5 pt-8">
          <h1 className="text-[22px] font-bold tracking-[-0.03em]">Coach</h1>
          <Segments tab="inbox" unread={unread} />
        </header>
        <div className="pb-10">
          <InboxRail items={items} />
        </div>
      </AppShell>
    );
  }

  const llmSettings = await db.query.llmSettings.findFirst({
    where: eq(schema.llmSettings.userId, user.id),
  });

  const threads = await db.query.chatThreads.findMany({
    where: eq(schema.chatThreads.userId, user.id),
    orderBy: desc(schema.chatThreads.updatedAt),
    limit: 20,
  });

  return (
    <AppShell noChrome>
      <ChatInterface
        configured={!!llmSettings}
        defaultMode={llmSettings?.defaultMode ?? "deep"}
        initialThreadId={initialThreadId ?? null}
        segmentNav={<Segments tab="chat" unread={unread} />}
        threads={threads.map((t) => ({
          id: t.id,
          title: t.title ?? "New chat",
          updatedAt: t.updatedAt.toISOString(),
          ephemeral: t.ephemeral,
        }))}
      />
    </AppShell>
  );
}
