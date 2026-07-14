import { eq, desc } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { AppShell } from "@/components/app-shell";
import { ChatInterface } from "@/components/coach/chat-interface";

export default async function CoachPage() {
  const user = await requireUser();

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
        threads={threads.map((t) => ({
          id: t.id,
          title: t.title ?? "New chat",
          updatedAt: t.updatedAt.toISOString(),
        }))}
      />
    </AppShell>
  );
}
