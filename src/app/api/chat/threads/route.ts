import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { and, eq, asc } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, schema } from "@/lib/db";

export const dynamic = "force-dynamic";

/** GET /api/chat/threads?id=<threadId> — load messages for a thread */
export async function GET(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  const url = new URL(req.url);
  const threadId = url.searchParams.get("id");
  if (!threadId) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  // Verify ownership
  const thread = await db.query.chatThreads.findFirst({
    where: and(
      eq(schema.chatThreads.id, threadId),
      eq(schema.chatThreads.userId, session.user.id)
    ),
  });
  if (!thread) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const messages = await db.query.chatMessages.findMany({
    where: eq(schema.chatMessages.threadId, threadId),
    orderBy: asc(schema.chatMessages.createdAt),
  });

  return NextResponse.json({
    thread: { id: thread.id, title: thread.title },
    messages: messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
      })),
  });
}
