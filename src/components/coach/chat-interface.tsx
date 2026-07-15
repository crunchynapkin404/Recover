"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Ghost, Plus, Send } from "lucide-react";

interface ThreadSummary {
  id: string;
  title: string;
  updatedAt: string;
  ephemeral: boolean;
}

interface Props {
  configured: boolean;
  defaultMode: "quick" | "deep";
  initialThreadId?: string | null;
  threads: ThreadSummary[];
}

export function ChatInterface({
  configured,
  defaultMode,
  initialThreadId,
  threads,
}: Props) {
  const [activeThreadId, setActiveThreadId] = useState<string | null>(
    initialThreadId ?? null
  );
  const [threadList] = useState(threads);
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<"quick" | "deep">(defaultMode);
  const [ghost, setGhost] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        body: {
          threadId: activeThreadId,
          mode,
          ephemeral: ghost && !activeThreadId,
        },
      }),
    [activeThreadId, mode, ghost]
  );

  const {
    messages,
    sendMessage,
    status,
    setMessages,
    error: chatError,
  } = useChat({
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

  const fetchThreadMessages = useCallback(
    async (threadId: string) => {
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

  const loadThread = useCallback(
    async (threadId: string) => {
      setActiveThreadId(threadId);
      await fetchThreadMessages(threadId);
    },
    [fetchThreadMessages]
  );

  // Deep link (?thread=…): activeThreadId is seeded from the prop above;
  // fetch its messages once on mount.
  useEffect(() => {
    if (initialThreadId) void fetchThreadMessages(initialThreadId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startNewChat = useCallback(() => {
    setActiveThreadId(null);
    setGhost(false);
    setMessages([]);
  }, [setMessages]);

  if (!configured) {
    return (
      <div className="flex min-h-[60svh] items-center justify-center px-6">
        <div className="glass mx-auto max-w-sm rounded-[2.5rem] p-8 text-center">
          <p className="mb-4 text-sm text-white/60">
            The AI coach needs an LLM key to work. Add your Anthropic API key or
            configure a local Ollama endpoint in Settings.
          </p>
          <Link
            href="/settings"
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-6 py-3 font-bold text-black transition-all hover:bg-emerald-400"
          >
            Configure AI Coach
          </Link>
        </div>
      </div>
    );
  }

  const suggestions = [
    "How should I train today?",
    "Why is my HRV low?",
    "Analyze my week",
  ];

  return (
    <div className="flex min-h-svh flex-col">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <header className="relative z-20 px-6 pb-4 pt-8">
        <div className="flex items-center justify-between">
          <Link
            href="/"
            className="glass flex h-10 w-10 items-center justify-center rounded-full transition-transform active:scale-95"
          >
            <ArrowLeft className="size-[18px]" />
          </Link>
          <div className="flex flex-col items-center">
            <h1 className="text-lg font-bold tracking-tight">AI Coach</h1>
            <div className="flex items-center gap-1.5 opacity-60">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              <span className="text-[9px] font-bold uppercase tracking-widest">
                Personalized Logic
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!activeThreadId && (
              <button
                onClick={() => setGhost((g) => !g)}
                aria-pressed={ghost}
                aria-label="Ghost chat — deletes after 24 hours"
                className={`glass flex h-10 w-10 items-center justify-center rounded-full transition-transform active:scale-95 ${
                  ghost ? "bg-purple-500/20 text-purple-300" : "text-white/60"
                }`}
              >
                <Ghost className="size-[18px]" />
              </button>
            )}
            <button
              onClick={startNewChat}
              className="glass flex h-10 w-10 items-center justify-center rounded-full transition-transform active:scale-95"
            >
              <Plus className="size-[18px]" />
            </button>
          </div>
        </div>

        {ghost && !activeThreadId && (
          <p className="mt-2 text-center text-[9px] font-bold uppercase tracking-widest text-purple-300/70">
            Ghost chat — deletes in 24 h, coach won&apos;t save memories
          </p>
        )}

        {/* Thread pills */}
        <div className="hide-scrollbar -mx-6 mt-4 flex gap-2 overflow-x-auto px-6">
          <button
            onClick={startNewChat}
            className={`glass whitespace-nowrap rounded-full px-4 py-2 text-[10px] font-bold uppercase tracking-wider ${
              !activeThreadId ? "bg-white/10 text-white" : "text-white/50"
            }`}
          >
            Today
          </button>
          {threadList
            .filter((t) => !t.ephemeral)
            .map((t) => (
              <button
                key={t.id}
                onClick={() => loadThread(t.id)}
                className={`glass whitespace-nowrap rounded-full px-4 py-2 text-[10px] font-bold uppercase tracking-wider ${
                  t.id === activeThreadId
                    ? "bg-white/10 text-white"
                    : "text-white/50"
                }`}
              >
                {t.title}
              </button>
            ))}
          {threadList
            .filter((t) => t.ephemeral)
            .map((t) => (
              <button
                key={t.id}
                onClick={() => loadThread(t.id)}
                className={`glass flex items-center gap-1.5 whitespace-nowrap rounded-full px-4 py-2 text-[10px] font-bold uppercase tracking-wider ${
                  t.id === activeThreadId
                    ? "bg-purple-500/20 text-purple-200"
                    : "text-purple-300/50"
                }`}
              >
                <Ghost className="size-3" aria-hidden />
                {t.title}
              </button>
            ))}
        </div>
      </header>

      {/* ── Messages ────────────────────────────────────────────────── */}
      <main
        ref={scrollRef}
        className="hide-scrollbar flex-1 overflow-y-auto px-6 pb-56 pt-2"
      >
        {messages.length === 0 && (
          <div className="flex h-full items-center justify-center text-center text-sm text-white/50">
            <p>
              Ask about your readiness, training load, recovery trends, or
              anything related to your training.
            </p>
          </div>
        )}
        {messages.map((m) => {
          const text =
            m.parts
              ?.filter(
                (p): p is { type: "text"; text: string } => p.type === "text"
              )
              .map((p) => p.text)
              .join("") ?? "";
          if (!text) return null;
          const isUser = m.role === "user";
          return (
            <div
              key={m.id}
              className={`mb-6 flex w-full flex-col ${
                isUser
                  ? "ml-auto max-w-[85%] items-end"
                  : "max-w-[90%] items-start"
              }`}
            >
              <div
                className={`rounded-2xl p-4 text-sm leading-relaxed text-white/90 ${
                  isUser ? "chat-bubble-user" : "chat-bubble-ai"
                }`}
              >
                <span className="whitespace-pre-wrap">{text}</span>
              </div>
              <span className="mt-2 text-[9px] font-bold uppercase text-white/50">
                {new Date().toLocaleTimeString([], {
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </span>
            </div>
          );
        })}
        {isLoading && (
          <div className="mb-6 flex max-w-[85%] flex-col items-start">
            <div className="chat-bubble-ai rounded-2xl p-4 text-sm">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400 [animation-delay:0.2s]" />
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400 [animation-delay:0.4s]" />
              </span>
            </div>
          </div>
        )}
        {chatError && (
          <div className="mb-6 flex max-w-[85%] flex-col items-start">
            <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-400">
              Coach error:{" "}
              {chatError.message || "Connection failed. Check LLM settings."}
            </div>
          </div>
        )}

        {/* Suggestion pills */}
        {messages.length === 0 && (
          <div className="hide-scrollbar -mx-6 mt-4 flex gap-2 overflow-x-auto px-6">
            {suggestions.map((s) => (
              <button
                key={s}
                onClick={() => {
                  setInput(s);
                }}
                className="glass whitespace-nowrap rounded-xl border-white/5 px-4 py-2 text-[11px] font-medium text-white/60"
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </main>

      {/* ── Input area ──────────────────────────────────────────────── */}
      <div className="fixed bottom-24 left-0 z-40 w-full px-6">
        <form
          onSubmit={handleSubmit}
          className="flex items-center gap-2 rounded-[2rem] border border-white/8 bg-white/3 p-2 shadow-2xl backdrop-blur-xl"
        >
          <div
            role="group"
            aria-label="Thinking mode"
            className="flex shrink-0 rounded-full bg-white/5 p-0.5"
          >
            {(["quick", "deep"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                aria-pressed={mode === m}
                className={`rounded-full px-2.5 py-1.5 text-[9px] font-bold uppercase tracking-wider transition-colors ${
                  mode === m
                    ? "bg-emerald-500/20 text-emerald-400"
                    : "text-white/40"
                }`}
              >
                {m === "quick" ? "⚡ Quick" : "🧠 Deep"}
              </button>
            ))}
          </div>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask your coach..."
            className="flex-1 bg-transparent px-2 py-2 text-sm text-white outline-none placeholder:text-white/50"
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500 text-black shadow-[0_0_20px_rgba(16,185,129,0.3)] transition-transform active:scale-90 disabled:opacity-40"
          >
            <Send className="size-[18px]" />
          </button>
        </form>
      </div>
    </div>
  );
}
