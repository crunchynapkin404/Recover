import { stepCountIs, streamText } from "ai";
import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { logger } from "@/lib/logger";
import { resolveProvider } from "@/lib/llm-provider";
import { recordLlmUsage } from "@/lib/llm-usage";
import { buildSystemPrompt } from "@/lib/coach-persona";
import { buildAiSdkTools } from "@/lib/tools/registry";
import { fetchAthleteContext } from "@/lib/coach-context";
import { memoryPromptBlock } from "@/lib/coach-memory";

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
  const {
    messages: rawMessages,
    threadId,
    mode,
    ephemeral,
  } = body as {
    messages: Array<{
      role: string;
      content?: string;
      parts?: Array<{ type: string; text?: string }>;
    }>;
    threadId?: string;
    mode?: "quick" | "deep";
    ephemeral?: boolean;
  };

  if (!rawMessages || !Array.isArray(rawMessages) || rawMessages.length === 0) {
    return new Response("messages required", { status: 400 });
  }

  // Normalize: AI SDK v7 sends parts[], older format sends content
  const messages = rawMessages.map((m) => ({
    role: m.role,
    content:
      m.content ??
      m.parts
        ?.filter((p) => p.type === "text")
        .map((p) => p.text)
        .join("") ??
      "",
  }));

  // Resolve LLM provider (thinking mode picks the quick/deep model slot)
  const resolved = await resolveProvider(
    userId,
    mode === "quick" || mode === "deep" ? mode : undefined
  );
  if (!resolved) {
    return Response.json(
      {
        error:
          "No LLM configured. Go to Settings → AI Coach to add your API key.",
      },
      { status: 422 }
    );
  }

  // Thread management — create or verify ownership. Ghost (ephemeral)
  // threads suppress memory writes and are purged by the scheduler.
  let activeThreadId = threadId;
  let isGhost = ephemeral === true;
  if (activeThreadId) {
    const thread = await db.query.chatThreads.findFirst({
      where: eq(schema.chatThreads.id, activeThreadId),
    });
    if (!thread || thread.userId !== userId) {
      return new Response("Thread not found", { status: 404 });
    }
    isGhost = thread.ephemeral;
  } else {
    // Create new thread
    const firstMsg = messages[messages.length - 1]?.content ?? "New chat";
    const title = firstMsg.slice(0, 80);
    const [thread] = await db
      .insert(schema.chatThreads)
      .values({ userId, title, ephemeral: isGhost })
      .returning();
    activeThreadId = thread.id;
  }

  // Persist the user message
  const lastUserMsg = messages[messages.length - 1];
  if (lastUserMsg?.role === "user" && lastUserMsg.content) {
    await db.insert(schema.chatMessages).values({
      threadId: activeThreadId,
      role: "user",
      content: lastUserMsg.content,
    });
  }

  // Build system prompt with user context, coach memory + real athlete data
  const [memoryBlock, athleteSnapshot] = await Promise.all([
    memoryPromptBlock(userId),
    fetchAthleteContext(userId, db),
  ]);
  const basePrompt = buildSystemPrompt({
    userName: session.user.name,
    todayDate: new Date().toISOString().slice(0, 10),
    personality: resolved.personality,
    memoryBlock,
  });
  const systemPrompt = `${basePrompt}\n\n${athleteSnapshot}`;

  // One registry, every provider: OpenAI-compatible endpoints (Ollama, LM
  // Studio, OpenRouter) support tool calling too — without tools the coach
  // can only hallucinate numbers, which the persona forbids.
  const tools = buildAiSdkTools({
    userId,
    db,
    ephemeral: isGhost,
    threadId: activeThreadId ?? undefined,
  });

  // LLM generation parameters — lower temperature for factual coaching
  const generationParams =
    resolved.providerType === "openai_compatible"
      ? { temperature: 0.3, topP: 0.9, frequencyPenalty: 0.3 }
      : { temperature: 0.4 };

  // Stream the response
  const result = streamText({
    model: resolved.provider(resolved.model),
    system: systemPrompt,
    messages: messages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
    tools,
    ...generationParams,
    stopWhen: stepCountIs(6),
    onFinish: async ({ text, totalUsage }) => {
      await recordLlmUsage({
        userId,
        model: resolved.model,
        slot: resolved.slot,
        purpose: "chat",
        inputTokens: totalUsage?.inputTokens,
        outputTokens: totalUsage?.outputTokens,
      });
      // Persist assistant response (skip if empty — e.g. tool-only responses)
      if (text?.trim() && activeThreadId) {
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
