"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

interface ThreadSummary {
  id: string;
  title: string;
  updatedAt: string;
}

interface Props {
  configured: boolean;
  threads: ThreadSummary[];
}

export function ChatInterface({ configured, threads }: Props) {
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [threadList] = useState(threads);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        body: { threadId: activeThreadId },
      }),
    [activeThreadId]
  );

  const { messages, sendMessage, status, setMessages } = useChat({
    transport,
    onFinish() {
      scrollRef.current?.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: "smooth",
      });
    },
  });

  const isLoading = status === "streaming" || status === "submitted";

  const handleSubmit = useCallback(
    (e?: { preventDefault?: () => void }) => {
      e?.preventDefault?.();
      if (!input.trim() || isLoading) return;
      sendMessage({ text: input });
      setInput("");
    },
    [input, isLoading, sendMessage]
  );

  const loadThread = useCallback(
    async (threadId: string) => {
      setActiveThreadId(threadId);
      try {
        const res = await fetch(`/api/chat/threads?id=${threadId}`);
        if (res.ok) {
          const data = await res.json();
          setMessages(
            data.messages.map(
              (m: { id: string; role: string; content: string }) => ({
                id: m.id,
                role: m.role as "user" | "assistant",
                parts: [{ type: "text" as const, text: m.content }],
              })
            )
          );
        }
      } catch {
        // ignore fetch errors
      }
    },
    [setMessages]
  );

  const startNewChat = useCallback(() => {
    setActiveThreadId(null);
    setMessages([]);
  }, [setMessages]);

  if (!configured) {
    return (
      <Card className="mx-auto max-w-md">
        <CardContent className="pt-6">
          <p className="text-muted-foreground mb-4">
            The AI coach needs an LLM key to work. Add your Anthropic API key or
            configure a local Ollama endpoint in Settings.
          </p>
          <Button render={<Link href="/settings" />} nativeButton={false}>
            Configure AI Coach
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex gap-4" style={{ height: "calc(100svh - 180px)" }}>
      {/* Thread sidebar */}
      <aside className="hidden w-56 shrink-0 overflow-y-auto md:block">
        <Button
          variant="outline"
          size="sm"
          className="mb-3 w-full"
          onClick={startNewChat}
        >
          + New chat
        </Button>
        <div className="grid gap-1">
          {threadList.map((t) => (
            <button
              key={t.id}
              onClick={() => loadThread(t.id)}
              className={`truncate rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                t.id === activeThreadId
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/50"
              }`}
            >
              {t.title}
            </button>
          ))}
        </div>
      </aside>

      {/* Chat area */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Messages */}
        <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto pb-4">
          {messages.length === 0 && (
            <div className="text-muted-foreground flex h-full items-center justify-center text-center text-sm">
              <p>
                Ask about your readiness, training load, recovery trends, or
                anything related to your training.
              </p>
            </div>
          )}
          {messages.map((m) => {
            const text = m.parts
              ?.filter((p): p is { type: "text"; text: string } => p.type === "text")
              .map((p) => p.text)
              .join("") ?? "";
            if (!text) return null;
            return (
              <div
                key={m.id}
                className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[80%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
                    m.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted"
                  }`}
                >
                  {text}
                </div>
              </div>
            );
          })}
          {isLoading &&
            messages.at(-1)?.role !== "assistant" && (
              <div className="flex justify-start">
                <div className="bg-muted rounded-lg px-3 py-2 text-sm">
                  <span className="animate-pulse">Thinking…</span>
                </div>
              </div>
            )}
        </div>

        {/* Input */}
        <form onSubmit={handleSubmit} className="border-t pt-3">
          <div className="flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about your recovery…"
              className="border-input bg-background flex-1 rounded-md border px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
              disabled={isLoading}
            />
            <Button type="submit" disabled={isLoading || !input.trim()}>
              Send
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
