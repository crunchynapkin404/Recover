import { streamText } from "ai";
import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { logger } from "@/lib/logger";
import { resolveProvider } from "@/lib/llm-provider";
import { buildSystemPrompt } from "@/lib/coach-persona";
import { buildAiSdkTools } from "@/lib/tools/registry";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  // Auth check
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }
  const userId = session.user.id;

  // Parse request body
  const body = await req.json();
  const { messages, threadId } = body as {
    messages: Array<{ role: string; content: string }>;
    threadId?: string;
  };

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return new Response("messages required", { status: 400 });
  }

  // Resolve LLM provider
  const resolved = await resolveProvider(userId);
  if (!resolved) {
    return Response.json(
      { error: "No LLM configured. Go to Settings → AI Coach to add your API key." },
      { status: 422 }
    );
  }

  // Thread management — create or verify ownership
  let activeThreadId = threadId;
  if (activeThreadId) {
    const thread = await db.query.chatThreads.findFirst({
      where: eq(schema.chatThreads.id, activeThreadId),
    });
    if (!thread || thread.userId !== userId) {
      return new Response("Thread not found", { status: 404 });
    }
  } else {
    // Create new thread
    const firstMsg = messages[messages.length - 1]?.content ?? "New chat";
    const title = firstMsg.slice(0, 80);
    const [thread] = await db
      .insert(schema.chatThreads)
      .values({ userId, title })
      .returning();
    activeThreadId = thread.id;
  }

  // Persist the user message
  const lastUserMsg = messages[messages.length - 1];
  if (lastUserMsg?.role === "user") {
    await db.insert(schema.chatMessages).values({
      threadId: activeThreadId,
      role: "user",
      content: lastUserMsg.content,
    });
  }

  // Build system prompt with user context
  const systemPrompt = buildSystemPrompt({
    userName: session.user.name,
    todayDate: new Date().toISOString().slice(0, 10),
  });

  // Build tool registry bound to this user
  const tools = buildAiSdkTools({ userId, db });

  // Stream the response
  const result = streamText({
    model: resolved.provider(resolved.model),
    system: systemPrompt,
    messages: messages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
    tools,
    onFinish: async ({ text }) => {
      // Persist assistant response
      if (text && activeThreadId) {
        await db.insert(schema.chatMessages).values({
          threadId: activeThreadId,
          role: "assistant",
          content: text,
        });
        // Update thread timestamp
        await db
          .update(schema.chatThreads)
          .set({ updatedAt: new Date() })
          .where(eq(schema.chatThreads.id, activeThreadId));
      }
    },
  });

  logger.info("chat stream started", { userId, threadId: activeThreadId });

  // Return streaming response with thread ID header
  return result.toUIMessageStreamResponse({
    headers: { "X-Thread-Id": activeThreadId! },
  });
}
