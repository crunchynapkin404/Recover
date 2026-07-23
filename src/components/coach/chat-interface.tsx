"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ChevronDown,
  Ghost,
  History,
  Mic,
  MicOff,
  Send,
  Sparkles,
  SquarePen,
} from "lucide-react";
import { ArtifactCard } from "./artifact-card";
import { HistoryPanel, type HistoryThread } from "./history-panel";
import { useDictation } from "@/lib/use-dictation";
import { InlineMarkdown } from "@/components/ui/inline-markdown";
import { EmptyState } from "@/components/ui/empty-state";
import type { ChartSpec } from "@/lib/tools/render-chart";
import type { InboxItem } from "@/lib/coach-inbox";

interface Props {
  configured: boolean;
  defaultMode: "quick" | "deep";
  initialThreadId?: string | null;
  /** Non-ephemeral + ghost chat threads (kind === "chat" only — system
   * threads are read through `inboxItems` instead). */
  threads: HistoryThread[];
  inboxItems: InboxItem[];
  unread: number;
}

const SUGGESTIONS = [
  "How should I train today?",
  "Why is my HRV low?",
  "Analyze my week",
] as const;

export function ChatInterface({
  configured,
  defaultMode,
  initialThreadId,
  threads,
  inboxItems,
  unread,
}: Props) {
  const [activeThreadId, setActiveThreadId] = useState<string | null>(
    initialThreadId ?? null
  );
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<"quick" | "deep">(defaultMode);
  const [ghost, setGhost] = useState(false);
  const [showThreadMenu, setShowThreadMenu] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Wrap fetch to capture X-Thread-Id from the streaming response and adopt
  // it once, so a new conversation doesn't spawn a fresh thread per message.
  // Closes over activeThreadId directly (transport re-memoizes on it below).
  const wrappedFetch = useCallback(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const res = await fetch(input, init);
      const newThreadId = res.headers.get("X-Thread-Id");
      if (newThreadId && !activeThreadId) {
        setActiveThreadId(newThreadId);
      }
      return res;
    },
    [activeThreadId]
  );

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        body: {
          threadId: activeThreadId,
          mode,
          ephemeral: ghost && !activeThreadId,
        },
        fetch: wrappedFetch,
      }),
    [activeThreadId, mode, ghost, wrappedFetch]
  );

  const {
    messages,
    sendMessage,
    status,
    setMessages,
    error: chatError,
  } = useChat({ transport });

  const isLoading = status === "streaming" || status === "submitted";

  // Auto-scroll on every message change — new user bubble, streaming growth,
  // and the typing indicator all count as a "message change".
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, isLoading]);

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

  // Deep link (?thread=…): activeThreadId is seeded from the prop above;
  // fetch its messages once on mount. Switching threads via History always
  // remounts this component (page.tsx keys it by thread id) rather than
  // updating this in place, so a mount-only effect is correct here.
  useEffect(() => {
    if (initialThreadId) void fetchThreadMessages(initialThreadId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sendText = useCallback(
    (text: string) => {
      if (!text.trim() || isLoading) return;
      sendMessage({ text });
      setInput("");
      if (taRef.current) taRef.current.style.height = "auto";
    },
    [isLoading, sendMessage]
  );

  const handleSubmit = useCallback(
    (e?: { preventDefault?: () => void }) => {
      e?.preventDefault?.();
      sendText(input);
    },
    [input, sendText]
  );

  const handleTextareaChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setInput(e.target.value);
      const ta = e.target;
      ta.style.height = "auto";
      ta.style.height = `${Math.min(120, ta.scrollHeight)}px`;
    },
    []
  );

  const handleTextareaKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendText(input);
      }
    },
    [input, sendText]
  );

  // ── v0.15 voice input — Web Speech API, dictation only (never auto-sends).
  const [showDictationHint, setShowDictationHint] = useState(false);
  const dictation = useDictation((chunk) =>
    setInput((prev) => (prev ? prev + " " : "") + chunk)
  );

  /** Wraps the shared hook to show the one-time processing hint. */
  const toggleDictation = useCallback(() => {
    if (
      !dictation.dictating &&
      !localStorage.getItem("recover-dictation-hint")
    ) {
      localStorage.setItem("recover-dictation-hint", "1");
      setShowDictationHint(true);
    }
    dictation.toggle();
  }, [dictation]);

  const startNewChat = useCallback(() => {
    setActiveThreadId(null);
    setGhost(false);
    setMessages([]);
  }, [setMessages]);

  // Desktop dropdown: close on Esc or a click outside the button+panel.
  useEffect(() => {
    if (!showThreadMenu) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setShowThreadMenu(false);
    }
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowThreadMenu(false);
      }
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [showThreadMenu]);

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

  const activeTitle =
    threads.find((t) => t.id === activeThreadId)?.title ??
    inboxItems.find((i) => i.threadId === activeThreadId)?.title ??
    "New chat";
  const historyHref = `/coach?history=1${activeThreadId ? `&thread=${activeThreadId}` : ""}`;

  return (
    <div className="flex h-svh flex-col">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <header className="relative z-20 shrink-0">
        <div className="mx-auto w-full max-w-3xl px-5 pt-6 lg:pt-7">
          {/* Mobile */}
          <div className="flex items-center justify-between lg:hidden">
            <h1 className="text-[22px] font-bold tracking-[-0.03em]">Coach</h1>
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
              <Link
                href={historyHref}
                aria-label="History and inbox"
                className="glass flex items-center gap-1.5 rounded-full px-3.5 py-2.5 text-[10px] font-bold uppercase tracking-wider text-white/60"
              >
                <History className="size-3.5" aria-hidden />
                History
                {unread > 0 && (
                  <span className="text-emerald-400">· {unread}</span>
                )}
              </Link>
              <button
                onClick={startNewChat}
                aria-label="Start new chat"
                className="glass flex h-10 w-10 items-center justify-center rounded-full transition-transform active:scale-95"
              >
                <SquarePen aria-hidden className="size-[18px]" />
              </button>
            </div>
          </div>

          {/* Desktop */}
          <div className="hidden items-center justify-between lg:flex">
            <div ref={menuRef} className="relative">
              <button
                onClick={() => setShowThreadMenu((v) => !v)}
                aria-expanded={showThreadMenu}
                aria-haspopup="true"
                className="glass flex max-w-[420px] items-center gap-2 rounded-2xl px-3.5 py-2.5"
              >
                <span className="truncate text-[14px] font-bold tracking-[-0.02em]">
                  {activeTitle}
                </span>
                {unread > 0 && (
                  <span className="shrink-0 text-[10px] font-bold text-emerald-400">
                    · {unread}
                  </span>
                )}
                <ChevronDown
                  aria-hidden
                  className={`size-3.5 shrink-0 text-white/40 transition-transform ${
                    showThreadMenu ? "rotate-180" : ""
                  }`}
                />
              </button>
              {showThreadMenu && (
                <div
                  onClickCapture={() => setShowThreadMenu(false)}
                  className="menu-pop absolute left-0 top-[calc(100%+8px)] z-30 max-h-[70vh] w-[400px] overflow-auto rounded-[18px] border border-white/[0.12] bg-neutral-950/98 p-3.5 shadow-2xl backdrop-blur-xl"
                >
                  <HistoryPanel
                    inboxItems={inboxItems}
                    threads={threads}
                    activeThreadId={activeThreadId}
                    unread={unread}
                  />
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              {!activeThreadId && (
                <button
                  onClick={() => setGhost((g) => !g)}
                  aria-pressed={ghost}
                  aria-label="Ghost chat — deletes after 24 hours"
                  className={`glass flex h-[38px] w-[38px] items-center justify-center rounded-full transition-transform active:scale-95 ${
                    ghost ? "bg-purple-500/20 text-purple-300" : "text-white/60"
                  }`}
                >
                  <Ghost className="size-4" />
                </button>
              )}
              <button
                onClick={startNewChat}
                aria-label="Start new chat"
                className="glass flex h-[38px] w-[38px] items-center justify-center rounded-full transition-transform active:scale-95"
              >
                <SquarePen aria-hidden className="size-4" />
              </button>
            </div>
          </div>
        </div>

        {ghost && !activeThreadId && (
          <p className="mt-2 text-center text-[9px] font-bold uppercase tracking-widest text-purple-300/70">
            Ghost chat — deletes in 24 h, coach won&apos;t save memories
          </p>
        )}
      </header>

      {/* ── Messages ────────────────────────────────────────────────── */}
      <main ref={scrollRef} className="hide-scrollbar flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-5 pb-4 pt-2">
          {messages.length === 0 && (
            <div className="flex flex-col items-center gap-5 pt-[8vh] text-center">
              <EmptyState
                icon={Sparkles}
                message="Ask about your readiness, training load, recovery trends — the coach cites your real numbers."
                className="max-w-sm"
              />
              <div className="flex w-full max-w-[300px] flex-col gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => sendText(s)}
                    className="glass rounded-2xl border-white/8 px-4 py-3 text-[12.5px] font-medium text-white/70"
                  >
                    {s}
                  </button>
                ))}
              </div>
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
            const artifacts = (m.parts ?? []).filter(
              (p) =>
                p.type === "tool-invocation" &&
                "result" in p &&
                typeof p.result === "object" &&
                p.result !== null &&
                (p.result as Record<string, unknown>).artifact === true
            );
            if (!text && artifacts.length === 0) return null;
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
                {text && (
                  <div
                    className={`rounded-2xl p-4 text-sm leading-relaxed text-white/90 ${
                      isUser ? "chat-bubble-user" : "chat-bubble-ai"
                    }`}
                  >
                    <span className="whitespace-pre-wrap">
                      <InlineMarkdown text={text} />
                    </span>
                  </div>
                )}
                {artifacts.map((p) => {
                  const part = p as unknown as {
                    toolCallId: string;
                    result: { spec: ChartSpec };
                  };
                  return (
                    <ArtifactCard
                      key={part.toolCallId}
                      spec={part.result.spec}
                    />
                  );
                })}
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
        </div>
      </main>

      {/* ── Composer (in flow — never fixed) ───────────────────────────── */}
      <div className="mx-auto w-full max-w-3xl px-4 pb-[calc(env(safe-area-inset-bottom)+96px)] lg:pb-6">
        <form
          onSubmit={handleSubmit}
          className="flex items-end gap-2 rounded-[26px] border border-white/10 bg-neutral-900/85 p-2 shadow-2xl backdrop-blur-xl"
        >
          <div
            role="group"
            aria-label="Thinking mode"
            className="mb-0.5 flex shrink-0 rounded-full bg-white/5 p-0.5"
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
                {m === "quick" ? "⚡" : "🧠"}
                <span className="hidden lg:inline">
                  {" "}
                  {m === "quick" ? "Quick" : "Deep"}
                </span>
              </button>
            ))}
          </div>
          <textarea
            ref={taRef}
            rows={1}
            value={input}
            onChange={handleTextareaChange}
            onKeyDown={handleTextareaKeyDown}
            placeholder="Message your coach…"
            disabled={isLoading}
            className="max-h-[120px] flex-1 resize-none bg-transparent px-2 py-2 text-sm leading-relaxed text-white outline-none placeholder:text-white/50"
          />
          {dictation.supported && (
            <button
              type="button"
              onClick={toggleDictation}
              aria-pressed={dictation.dictating}
              aria-label={
                dictation.dictating ? "Stop dictation" : "Dictate a message"
              }
              className={`mb-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors ${
                dictation.dictating
                  ? "bg-red-500/20 text-red-400"
                  : "bg-white/5 text-white/50"
              }`}
            >
              {dictation.dictating ? (
                <MicOff className="size-4" />
              ) : (
                <Mic className="size-4" />
              )}
            </button>
          )}
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            aria-label="Send message"
            className="mb-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-black shadow-[0_0_20px_rgba(16,185,129,0.3)] transition-transform active:scale-90 disabled:opacity-40"
          >
            <Send aria-hidden className="size-[18px]" />
          </button>
        </form>
        {showDictationHint && (
          <p className="mt-2 px-2 text-center text-[10px] text-white/40">
            Speech is transcribed by your browser and may be processed on its
            vendor&apos;s servers. Recover never sees or stores audio.
          </p>
        )}
      </div>
    </div>
  );
}
