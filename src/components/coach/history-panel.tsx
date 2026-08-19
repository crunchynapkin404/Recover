"use client";

import Link from "next/link";
import { Ghost, Search } from "lucide-react";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import type { InboxItem, InboxKind } from "@/lib/coach-inbox";

// Each kind gets one ink/tint token pair, defined in globals.css for BOTH
// themes and contrast-checked by tests/contrast-guard.test.ts. Raw hues used
// to live here and were applied as inline rgb() — unreadable in light, and
// invisible to every guard because the tile was never captured.
export const KIND_STYLE: Record<
  InboxKind,
  { glyph: string; ink: string; tint: string; label: string }
> = {
  morning: {
    glyph: "☀",
    ink: "var(--kind-morning-ink)",
    tint: "var(--kind-morning-tint)",
    label: "Morning brief",
  },
  debrief: {
    glyph: "✓",
    ink: "var(--kind-debrief-ink)",
    tint: "var(--kind-debrief-tint)",
    label: "Ride debrief",
  },
  weekly: {
    glyph: "▤",
    ink: "var(--kind-weekly-ink)",
    tint: "var(--kind-weekly-tint)",
    label: "Weekly review",
  },
  warning: {
    glyph: "⚠",
    ink: "var(--kind-warning-ink)",
    tint: "var(--kind-warning-tint)",
    label: "Overtraining watch",
  },
  monthly: {
    glyph: "◔",
    ink: "var(--kind-monthly-ink)",
    tint: "var(--kind-monthly-tint)",
    label: "Monthly report",
  },
};

/** "07:02" today, "Mon" this week, "Jul 14" beyond it. */
export function stamp(d: Date, now: Date): string {
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }
  const days = (now.getTime() - d.getTime()) / 86_400_000;
  if (days < 7) return d.toLocaleDateString("en-US", { weekday: "short" });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export interface HistoryThread {
  id: string;
  title: string;
  updatedAt: string;
  ephemeral: boolean;
}

interface HistoryPanelProps {
  inboxItems: InboxItem[];
  /** Already scoped to kind === "chat" — system threads live in inboxItems. */
  threads: HistoryThread[];
  activeThreadId: string | null;
  unread: number;
  now?: Date;
}

/**
 * The merged Inbox + History surface (v0.24) — "From your coach" (system
 * threads read as mail) above "Chats" (the athlete's own conversations).
 * Shared by the desktop dropdown and the mobile sheet; only the container
 * around it differs.
 */
export function HistoryPanel({
  inboxItems,
  threads,
  activeThreadId,
  unread,
  now = new Date(),
}: HistoryPanelProps) {
  const chats = threads.filter((t) => !t.ephemeral);
  const ghosts = threads.filter((t) => t.ephemeral);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 rounded-xl border border-hairline bg-surface-raised px-3 py-2.5 text-ink-muted">
        <Search className="size-3.5 shrink-0" aria-hidden />
        {/* Static for v1 — wires to recall search later. */}
        <input
          type="search"
          placeholder="Search chats & reviews"
          disabled
          className="w-full bg-transparent text-label text-ink-secondary outline-none placeholder:text-ink-muted"
        />
      </div>

      <div>
        <p className="px-1 pb-2 text-label font-bold uppercase tracking-[0.2em] text-ink-muted">
          From your coach
          {unread > 0 && <span className="text-accent"> · {unread}</span>}
        </p>
        {inboxItems.length === 0 ? (
          <p className="px-1 pb-3 text-label text-ink-muted">
            Nothing from the coach yet.
          </p>
        ) : (
          <div className="flex flex-col gap-0.5 pb-3">
            {inboxItems.map((item) => {
              const style = KIND_STYLE[item.kind];
              const active = item.threadId === activeThreadId;
              return (
                <Link
                  key={item.id}
                  href={`/coach?thread=${item.threadId}`}
                  className={`flex items-center gap-2.5 rounded-xl p-2 transition-colors ${
                    active ? "bg-surface-selected" : "hover:bg-surface-raised"
                  }`}
                >
                  <span
                    aria-hidden
                    className="flex size-7 shrink-0 items-center justify-center rounded-[9px] border text-label"
                    style={{
                      background: style.tint,
                      borderColor: style.ink,
                      color: style.ink,
                    }}
                  >
                    {style.glyph}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-caption font-bold text-ink-primary">
                        {item.title}
                      </span>
                      {item.unread && (
                        <span
                          className="size-1.5 shrink-0 rounded-full bg-accent"
                          aria-label="Unread"
                        />
                      )}
                    </span>
                    <span className="block truncate text-label text-ink-muted">
                      {item.preview}
                    </span>
                  </span>
                  <span className="shrink-0 text-label text-ink-muted">
                    {stamp(item.createdAt, now)}
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      <div>
        <p className="px-1 pb-2 text-label font-bold uppercase tracking-[0.2em] text-ink-muted">
          Chats
        </p>
        {chats.length === 0 && ghosts.length === 0 ? (
          <p className="px-1 text-label text-ink-muted">
            No conversations yet.
          </p>
        ) : (
          <div className="flex flex-col gap-0.5">
            {chats.map((t) => (
              <Link
                key={t.id}
                href={`/coach?thread=${t.id}`}
                // Marks the athlete's own chat-thread links specifically —
                // inbox items above and the ghost threads below share this
                // same `/coach?thread=` href shape, so
                // scripts/verify-surfaces.ts's resolveCoachThreadPath
                // targets `a[data-chat-thread]` to capture a real multi-turn
                // conversation instead of a single-message inbox item. Do
                // not remove this as unused markup.
                data-chat-thread
                // The selected thread was distinguished by background colour
                // alone until v0.113 — a WCAG 1.4.1 problem, and one axe
                // cannot report, because "this link is the page you are on"
                // is not something it can infer from a class. Same token
                // `ui/segmented-tabs.tsx` uses for a current nav item.
                aria-current={t.id === activeThreadId ? "page" : undefined}
                className={`flex items-center justify-between gap-2 rounded-xl px-2 py-2 transition-colors ${
                  t.id === activeThreadId
                    ? "bg-surface-selected text-ink-primary"
                    : "text-ink-secondary hover:bg-surface-raised"
                }`}
              >
                <span className="min-w-0 flex-1 truncate text-caption font-medium">
                  {t.title}
                </span>
                <span className="shrink-0 text-label text-ink-muted">
                  {stamp(new Date(t.updatedAt), now)}
                </span>
              </Link>
            ))}
            {ghosts.map((t) => (
              <Link
                key={t.id}
                href={`/coach?thread=${t.id}`}
                // Same colour-only problem as the chat rows above, and
                // worse here: ghost-tint against ghost-ink is a subtler
                // difference than the selected surface.
                aria-current={t.id === activeThreadId ? "page" : undefined}
                className={`flex items-center gap-1.5 rounded-xl px-2 py-2 transition-colors ${
                  t.id === activeThreadId
                    ? "bg-ghost-tint text-ghost-ink"
                    : "text-ghost-ink hover:bg-surface-raised"
                }`}
              >
                <Ghost className="size-3 shrink-0" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-caption font-medium">
                  {t.title}
                </span>
                <span className="shrink-0 text-label text-ink-muted">
                  {stamp(new Date(t.updatedAt), now)}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Mobile container (1c) — the same list, in the shared bottom-sheet shell. */
export function HistorySheet({
  inboxItems,
  threads,
  activeThreadId,
  unread,
  closeHref,
}: HistoryPanelProps & { closeHref: string }) {
  return (
    <BottomSheet title="History" closeHref={closeHref}>
      <HistoryPanel
        inboxItems={inboxItems}
        threads={threads}
        activeThreadId={activeThreadId}
        unread={unread}
      />
    </BottomSheet>
  );
}
